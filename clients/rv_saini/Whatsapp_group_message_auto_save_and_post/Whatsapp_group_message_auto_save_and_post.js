'use strict';

/**
 * Whatsapp_group_message_auto_save_and_post.js
 *
 * Interval-based auto-posting (minutes): min 3, max 4320, default 3
 * Robust reconnect logic with Redis + filesystem cache.
 *
 * ENV:
 *   ADMIN_PASSWORD_WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST
 *   WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST_MAX_POST
 *   WEBJS_CACHE_DIR (optional, default /tmp)
 *
 * WARNING: Unofficial WhatsApp automation may risk account ban.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const qrcode = require('qrcode');
const axios = require('axios');
const { Client, MessageMedia } = require('whatsapp-web.js');
const redis = require('../../../globle_helper/redisConfig');

const ADMIN_PASSWORD =
    process.env.ADMIN_PASSWORD_WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST || 'changeme';
const maxSavedPosts =
    Number(process.env.WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST_MAX_POST) || 10;

const MAX_QR_ATTEMPTS = 2;
const QR_ATTEMPT_TTL = 60 * 60; // seconds

const MIN_INTERVAL_MINUTES = 3;
const MAX_INTERVAL_MINUTES = 4320;
const DEFAULT_INTERVAL_MINUTES = 3;

const BASE_CACHE_DIR = process.env.WEBJS_CACHE_DIR || '/tmp';
const RECONNECT_TRIES = 3;
const RECONNECT_WAIT_MS = 5000;

process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});

module.exports = (bot) => {
    const prefix = 'wa_auto_post:';
    const waitingForPasswordPrefix = `${prefix}waiting_password:`;   // + userId
    const waSessionKey = `${prefix}wa_session:`;                     // + userId
    const waSelectedGroupsKey = `${prefix}selected_groups:`;         // + userId
    const waSavedPostsKey = `${prefix}saved_posts:`;                 // + userId
    const waIntervalMinutesKey = `${prefix}interval_minutes:`;       // + userId
    const waNotifierChatKey = `${prefix}notifier_chat:`;             // + userId
    const pendingPostPrefix = `${prefix}pending_post:`;              // + userId
    const waitingForPostPrefix = `${prefix}waiting_for_post:`;       // + userId
    const waitingForTimePrefix = `${prefix}waiting_for_time:`;       // + userId
    const qrAttemptsKeyPrefix = `${prefix}qr_attempts:`;             // + userId

    const waClients = new Map();       // userId -> meta
    const scheduledJobs = new Map();   // userId -> { timer, minutes }

    // ---------- cache dir helpers ----------

    function getCacheDirForUser(userId) {
        const safeBase = BASE_CACHE_DIR || os.tmpdir();
        return path.join(safeBase, `wwebjs_${String(userId)}`);
    }

    function ensureCacheDirWritable(userId) {
        const cacheDir = getCacheDirForUser(userId);
        try {
            fs.mkdirSync(cacheDir, { recursive: true });
        } catch (e) {
            throw new Error(`Could not create cache dir ${cacheDir}: ${e && e.message ? e.message : e}`);
        }
        try {
            const testFile = path.join(cacheDir, '.write_test');
            fs.writeFileSync(testFile, String(Date.now()));
            try { fs.unlinkSync(testFile); } catch (_) { }
        } catch (e) {
            throw new Error(`Cache dir ${cacheDir} not writable: ${e && e.message ? e.message : e}`);
        }
        return cacheDir;
    }

    function removeCacheDir(userId) {
        const cacheDir = getCacheDirForUser(userId);
        try {
            if (fs.existsSync(cacheDir)) {
                fs.rmSync(cacheDir, { recursive: true, force: true });
                console.log('[wa] removed cache dir for user', userId, cacheDir);
            }
        } catch (e) {
            console.warn('[wa] failed to remove cache dir', cacheDir, e && e.message ? e.message : e);
        }
    }

    // ---------- interval helpers ----------

    function clampIntervalMinutes(n) {
        if (typeof n !== 'number' || !isFinite(n)) return DEFAULT_INTERVAL_MINUTES;
        if (n < MIN_INTERVAL_MINUTES) return MIN_INTERVAL_MINUTES;
        if (n > MAX_INTERVAL_MINUTES) return MAX_INTERVAL_MINUTES;
        return Math.floor(n);
    }

    // ---------- client lifecycle ----------

    async function forceResetUserClient(userId, opts = {}) {
        const { keepSession = false } = opts;
        const key = String(userId);
        const meta = waClients.get(key);
        if (meta) {
            try {
                if (meta.qrTimeout) {
                    try { clearTimeout(meta.qrTimeout); } catch (_) { }
                    meta.qrTimeout = null;
                }
                if (meta.client) {
                    try {
                        console.log('[wa] force destroying old client for user', userId);
                        await meta.client.destroy();
                    } catch (e) {
                        console.error('[wa] error destroying old client for user', userId, e && e.message ? e.message : e);
                    }
                }
            } catch (err) {
                console.error('[wa] error during forceResetUserClient cleanup', err && err.message ? err.message : err);
            }
            waClients.delete(key);
        }

        try { await redis.del(`${qrAttemptsKeyPrefix}${userId}`).catch(() => null); } catch (_) { }

        if (!keepSession) {
            try { await redis.del(`${waSessionKey}${userId}`).catch(() => null); } catch (_) { }
            try { removeCacheDir(userId); } catch (_) { }
        }
    }

    async function reconnectClient(userId, tries = RECONNECT_TRIES) {
        console.log(`[wa] reconnectClient: attempting reconnect for user ${userId} (tries ${tries})`);

        try {
            const saved = await redis.get(`${waSessionKey}${userId}`).catch(() => null);
            if (!saved) {
                console.warn(
                    `[wa] reconnectClient: no saved session in Redis for user ${userId}. Will not auto-reconnect. Ask user to /login and scan QR.`
                );
                try {
                    const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                    if (notifier) {
                        await bot.telegram.sendMessage(
                            notifier,
                            '⚠️ Auto-reconnect failed: no saved WhatsApp session found. Please /login and scan QR to create a new session.'
                        );
                    }
                } catch (_) { }
                return false;
            }
        } catch (e) {
            console.error('[wa] reconnectClient: error checking saved session in redis', e && e.message ? e.message : e);
        }

        for (let attempt = 1; attempt <= tries; attempt++) {
            try {
                await forceResetUserClient(userId, { keepSession: true });

                try {
                    ensureCacheDirWritable(userId);
                } catch (e) {
                    console.error('[wa] reconnectClient cacheDir writable failed:', e && e.message ? e.message : e);
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            await bot.telegram.sendMessage(
                                notifier,
                                `⚠️ Server can't write WA cache files: ${e && e.message ? e.message : e}`
                            );
                        }
                    } catch (_) { }
                    return false;
                }

                const meta = ensureWAClientForUser(userId);
                const check = await waitForReadyOrQr(meta, 40000, 700);
                if (check.ready) {
                    console.log('[wa] reconnectClient succeeded for user', userId);
                    return true;
                } else {
                    console.warn('[wa] reconnectClient attempt', attempt, 'not ready:', check.error || 'no-ready');
                    await new Promise(r => setTimeout(r, RECONNECT_WAIT_MS));
                }
            } catch (e) {
                console.error('[wa] reconnectClient attempt error:', e && e.message ? e.message : e);
                await new Promise(r => setTimeout(r, RECONNECT_WAIT_MS));
            }
        }
        console.error('[wa] reconnectClient: all attempts failed for user', userId);
        return false;
    }

    async function waitForReadyOrQr(meta, timeoutMs = 20000, pollInterval = 500) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (meta.initError) return { ready: false, qr: meta.qr, error: meta.initErrorMsg || 'init error' };
            if (meta.ready) return { ready: true, qr: meta.qr };
            if (meta.qr) return { ready: false, qr: meta.qr };
            await new Promise(r => setTimeout(r, pollInterval));
        }
        return { ready: !!meta.ready, qr: meta.qr, error: meta.initError ? meta.initErrorMsg : 'timeout' };
    }

    async function getChatsSafe(client, timeoutMs = 20000, retries = 2, delayMs = 1000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const p = client.getChats();
                const res = await Promise.race([
                    p,
                    new Promise((_, rej) =>
                        setTimeout(() => rej(new Error(`getChats timeout ${timeoutMs}ms`)), timeoutMs)
                    ),
                ]);
                return res;
            } catch (err) {
                console.warn(`[wa] getChats attempt ${attempt} failed:`, err && err.message ? err.message : err);
                if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
                else throw err;
            }
        }
    }

    // ---------- ensure client ----------

    function ensureWAClientForUser(userId) {
        const key = String(userId);
        if (waClients.has(key)) return waClients.get(key);

        const meta = {
            client: null,
            ready: false,
            qr: null,
            qrTimeout: null,
            initPromise: null,
            initError: false,
            initErrorMsg: null,
            qrLimitNotified: false,
            cacheDir: null,
        };
        waClients.set(key, meta);

        meta.initPromise = (async () => {
            try {
                meta.initError = false;
                meta.initErrorMsg = null;
                meta.qrLimitNotified = false;

                let sessionObj = null;
                try {
                    const raw = await redis.get(`${waSessionKey}${userId}`);
                    if (raw) sessionObj = JSON.parse(raw);
                } catch (e) {
                    console.warn('[wa] failed to read session from redis', e && e.message ? e.message : e);
                }

                try {
                    const attemptsKey = `${qrAttemptsKeyPrefix}${userId}`;
                    const existing = await redis.get(attemptsKey);
                    if (!existing) await redis.set(attemptsKey, '0', 'EX', QR_ATTEMPT_TTL);
                } catch (e) { }

                let cacheDir = null;
                try {
                    cacheDir = ensureCacheDirWritable(userId);
                    meta.cacheDir = cacheDir;
                    console.log('[wa] using cacheDir for user', userId, cacheDir);
                } catch (e) {
                    meta.initError = true;
                    meta.initErrorMsg = `Cache dir setup failed: ${e && e.message ? e.message : e}`;
                    console.error('[wa] cache dir writable check failed for user', userId, meta.initErrorMsg);
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            await bot.telegram.sendMessage(
                                notifier,
                                `⚠️ Server can't write WhatsApp cache files. Error: ${meta.initErrorMsg}`
                            );
                        }
                    } catch (_) { }
                    waClients.delete(key);
                    return;
                }

                const puppeteerArgs = [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--single-process',
                    '--disable-gpu',
                    '--no-zygote',
                    '--disable-accelerated-2d-canvas',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-infobars',
                    '--window-size=1280,720',
                ];

                const clientOpts = {
                    puppeteer: {
                        headless: true,
                        args: puppeteerArgs,
                        userDataDir: cacheDir,
                    },
                };

                const exePath =
                    process.env.PUPPETEER_EXECUTABLE_PATH ||
                    process.env.CHROME_BIN ||
                    process.env.CHROME_PATH;
                if (exePath) {
                    clientOpts.puppeteer.executablePath = exePath;
                    console.log('[wa] using puppeteer executablePath from env:', exePath);
                } else {
                    console.log('[wa] no puppeteer executablePath env set - using bundled chromium (if available)');
                }

                if (sessionObj) {
                    clientOpts.session = sessionObj;
                    console.log('[wa] found saved session for user', userId);
                } else {
                    console.log('[wa] no saved session for user', userId);
                }

                const client = new Client(clientOpts);
                meta.client = client;

                // ---------- events ----------

                client.on('qr', async (qr) => {
                    try {
                        const attemptsKey = `${qrAttemptsKeyPrefix}${userId}`;
                        let attempts = 0;
                        try {
                            attempts = parseInt(await redis.get(attemptsKey), 10) || 0;
                        } catch (e) {
                            attempts = 0;
                        }

                        if (attempts >= MAX_QR_ATTEMPTS) {
                            if (!meta.qrLimitNotified) {
                                meta.qrLimitNotified = true;
                                try {
                                    const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                                    if (notifier) {
                                        await bot.telegram.sendMessage(
                                            notifier,
                                            `QR send limit reached (${MAX_QR_ATTEMPTS}). Please run /login again.`
                                        );
                                    }
                                } catch (_) { }
                            }
                            return;
                        }

                        const png = await qrcode.toDataURL(qr);
                        meta.qr = png;
                        if (meta.qrTimeout) clearTimeout(meta.qrTimeout);
                        meta.qrTimeout = setTimeout(() => { meta.qr = null; }, 90 * 1000);

                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            const base64 = png.split(',')[1];
                            const buffer = Buffer.from(base64, 'base64');
                            try {
                                await bot.telegram.sendPhoto(
                                    notifier,
                                    { source: buffer },
                                    { caption: `Scan this QR (attempt ${attempts + 1}/${MAX_QR_ATTEMPTS})` }
                                );
                                console.log('[wa] QR sent to Telegram for user', userId);
                            } catch (sendErr) {
                                console.error(
                                    '[wa] sendPhoto error for user',
                                    userId,
                                    sendErr && sendErr.message ? sendErr.message : sendErr
                                );
                                try {
                                    await bot.telegram.sendMessage(
                                        notifier,
                                        `Failed to send QR image. Please run /login again or check server logs.`
                                    );
                                } catch (_) { }
                            }
                        } else {
                            console.warn('[wa] no notifier chat set for user', userId);
                        }

                        try {
                            await redis.set(`${qrAttemptsKeyPrefix}${userId}`, String(attempts + 1), 'EX', QR_ATTEMPT_TTL);
                        } catch (e) { }
                    } catch (e) {
                        console.error('[wa] qr handler error', e && e.message ? e.message : e);
                    }
                });

                client.on('authenticated', async (session) => {
                    try {
                        await redis.set(`${waSessionKey}${userId}`, JSON.stringify(session));
                        await redis.del(`${qrAttemptsKeyPrefix}${userId}`).catch(() => null);
                        meta.qrLimitNotified = false;
                        console.log(`[wa] authenticated and saved session to redis for user ${userId}`);
                        try {
                            const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                            if (notifier) {
                                await bot.telegram.sendMessage(
                                    notifier,
                                    '✅ WhatsApp authenticated and session saved.'
                                );
                            }
                        } catch (_) { }
                    } catch (e) {
                        meta.initError = true;
                        meta.initErrorMsg =
                            'Failed to save WhatsApp session to Redis: ' + (e && e.message ? e.message : e);
                        console.error('[wa] saving session to redis failed:', e && e.message ? e.message : e);
                        try {
                            const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                            if (notifier) {
                                await bot.telegram.sendMessage(
                                    notifier,
                                    `⚠️ Failed to save session to Redis. Auto-reconnect may not work. Error: ${meta.initErrorMsg}`
                                );
                            }
                        } catch (_) { }
                    }
                });

                client.on('ready', async () => {
                    meta.ready = true;
                    console.log(`[wa] client ready for user ${userId}`);
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            await bot.telegram.sendMessage(notifier, 'WhatsApp connected and ready.');
                        }
                    } catch (_) { }
                });

                client.on('auth_failure', async (msg) => {
                    meta.initError = true;
                    meta.initErrorMsg = msg && msg.message ? msg.message : String(msg);
                    console.error(`[wa] auth failure for user ${userId}:`, msg);
                    try { await redis.del(`${waSessionKey}${userId}`).catch(() => null); } catch (_) { }
                    try { await redis.del(`${qrAttemptsKeyPrefix}${userId}`).catch(() => null); } catch (_) { }
                    try { removeCacheDir(userId); } catch (_) { }
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            await bot.telegram.sendMessage(
                                notifier,
                                '❌ WhatsApp auth failure. Please /login and scan QR again (session invalidated).'
                            );
                        }
                    } catch (_) { }
                });

                // IMPORTANT: yaha ab session delete nahi kar rahe
                client.on('disconnected', async (reason) => {
                    meta.ready = false;
                    console.warn(`[wa] disconnected for user ${userId}:`, reason);
                    try { await client.destroy(); } catch (_) { }
                    if (meta.qrTimeout) {
                        try { clearTimeout(meta.qrTimeout); } catch (_) { }
                        meta.qrTimeout = null;
                    }
                    waClients.delete(key);
                    // session + cache ko chhod dete hain, taki reconnectClient unko use kar sake
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            await bot.telegram.sendMessage(
                                notifier,
                                `WhatsApp disconnected: ${reason || 'unknown'}. Auto-reconnect try ho sakta hai. Agar QR phir se aaye to /login se dobara scan karo.`
                            );
                        }
                    } catch (_) { }
                });

                try {
                    await client.initialize();
                    console.log('[wa] client.initialize returned (no immediate error) for user', userId);
                } catch (initErr) {
                    meta.initError = true;
                    meta.initErrorMsg = initErr && initErr.message ? initErr.message : String(initErr);
                    console.error(
                        '[wa] client.initialize error for user',
                        userId,
                        initErr && initErr.stack ? initErr.stack : initErr
                    );
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) {
                            await bot.telegram.sendMessage(
                                notifier,
                                `WhatsApp client.initialize error:\n${meta.initErrorMsg}`
                            );
                        }
                    } catch (_) { }
                }
            } catch (e) {
                meta.initError = true;
                meta.initErrorMsg = e && e.message ? e.message : String(e);
                console.error('[wa] ensureWAClientForUser background error:', e && e.stack ? e.stack : e);
                waClients.delete(key);
            }
        })();

        return meta;
    }

    // ---------- Redis helpers ----------

    async function getUserSelectedGroups(userId) {
        try {
            const raw = await redis.get(`${waSelectedGroupsKey}${userId}`);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr;
        } catch (e) {
            console.warn('[wa] getUserSelectedGroups error:', e && e.message ? e.message : e);
        }
        return [];
    }

    async function setUserSelectedGroups(userId, arr) {
        try {
            await redis.set(`${waSelectedGroupsKey}${userId}`, JSON.stringify(arr));
        } catch (e) {
            console.warn('[wa] setUserSelectedGroups error:', e && e.message ? e.message : e);
        }
    }

    async function addSavedPostForUser(userId, msgJson) {
        const key = `${waSavedPostsKey}${userId}`;
        try {
            await redis.rpush(key, JSON.stringify(msgJson));
            try {
                await redis.ltrim(key, -maxSavedPosts, -1);
            } catch (e) {
                const len = await redis.llen(key);
                if (len > maxSavedPosts && typeof redis.lpop === 'function') {
                    const removeCount = len - maxSavedPosts;
                    for (let i = 0; i < removeCount; i++) await redis.lpop(key);
                }
            }
        } catch (e) {
            console.error('[wa] addSavedPostForUser error:', e && e.message ? e.message : e);
        }
    }

    async function fetchSavedPostsForUser(userId) {
        try {
            const arr = await redis.lrange(`${waSavedPostsKey}${userId}`, 0, -1);
            if (!arr || arr.length === 0) return [];
            return arr
                .map(x => { try { return JSON.parse(x); } catch { return null; } })
                .filter(Boolean);
        } catch (e) {
            console.error('[wa] fetchSavedPostsForUser error:', e && e.message ? e.message : e);
            return [];
        }
    }

    // ---------- send message helper ----------

    async function sendMessageToWhatsAppGroup(userId, client, savedMsg, groupId) {
        let closed = false;
        try {
            if (!client) throw new Error('WA client not available');

            if (savedMsg.photo) {
                const photo = Array.isArray(savedMsg.photo)
                    ? savedMsg.photo[savedMsg.photo.length - 1]
                    : savedMsg.photo;
                const fileId = photo.file_id;
                const fileUrl = await bot.telegram.getFileLink(fileId);
                const buffer = (await axios.get(fileUrl.href, { responseType: 'arraybuffer' })).data;
                const base64 = buffer.toString('base64');
                const mime = photo.mime_type || 'image/jpeg';
                const media = new MessageMedia(mime, base64);
                await client.sendMessage(groupId, media, { caption: savedMsg.caption || '' });
                return { ok: true, closed: false };
            }

            if (savedMsg.video) {
                const fileId = savedMsg.video.file_id;
                const fileUrl = await bot.telegram.getFileLink(fileId);
                const buffer = (await axios.get(fileUrl.href, { responseType: 'arraybuffer' })).data;
                const base64 = buffer.toString('base64');
                const mime = savedMsg.video.mime_type || 'video/mp4';
                const media = new MessageMedia(mime, base64);
                await client.sendMessage(groupId, media, { caption: savedMsg.caption || '' });
                return { ok: true, closed: false };
            }

            if (savedMsg.document) {
                const fileId = savedMsg.document.file_id;
                const fileUrl = await bot.telegram.getFileLink(fileId);
                const buffer = (await axios.get(fileUrl.href, { responseType: 'arraybuffer' })).data;
                const base64 = buffer.toString('base64');
                const mime = savedMsg.document.mime_type || 'application/octet-stream';
                const filename = savedMsg.document.file_name || 'file';
                const media = new MessageMedia(mime, base64, filename);
                await client.sendMessage(groupId, media, { caption: savedMsg.caption || '' });
                return { ok: true, closed: false };
            }

            if (savedMsg.audio || savedMsg.voice) {
                const aud = savedMsg.audio || savedMsg.voice;
                const fileId = aud.file_id;
                const fileUrl = await bot.telegram.getFileLink(fileId);
                const buffer = (await axios.get(fileUrl.href, { responseType: 'arraybuffer' })).data;
                const base64 = buffer.toString('base64');
                const mime = aud.mime_type || 'audio/ogg';
                const media = new MessageMedia(mime, base64);
                await client.sendMessage(groupId, media, { caption: savedMsg.caption || '' });
                return { ok: true, closed: false };
            }

            if (savedMsg.text || savedMsg.caption) {
                const text = savedMsg.text || savedMsg.caption || '';
                await client.sendMessage(groupId, text);
                return { ok: true, closed: false };
            }

            console.log('[wa] unsupported saved message type', savedMsg);
            return { ok: false, closed: false };
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            console.error('[wa] sendMessageToWhatsAppGroup error:', msg);

            if (
                msg.includes('Session closed') ||
                msg.includes('Most likely the page has been closed') ||
                msg.includes('Target closed')
            ) {
                closed = true;
                console.error(
                    '[wa] Detected closed browser/session while sending message. Resetting client (keeping session) for user',
                    userId
                );

                try {
                    await forceResetUserClient(userId, { keepSession: true });
                } catch (resetErr) {
                    console.error(
                        '[wa] error while forceResetUserClient after closed session',
                        resetErr && resetErr.message ? resetErr.message : resetErr
                    );
                }

                try {
                    const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                    if (notifier) {
                        await bot.telegram.sendMessage(
                            notifier,
                            '⚠️ WhatsApp browser session appears to be closed/crashed.\n' +
                            'Attempting automatic reconnect (no QR). If this repeats, please /login and scan QR.'
                        );
                    }
                } catch (notifyErr) {
                    console.error(
                        '[wa] error notifying user about closed session',
                        notifyErr && notifyErr.message ? notifyErr.message : notifyErr
                    );
                }
            }

            return { ok: false, closed };
        }
    }

    // ---------- posting cycle ----------

    async function performPostingCycleForUser(userId) {
        try {
            let meta = ensureWAClientForUser(userId);

            let check = await waitForReadyOrQr(meta, 10000, 500);
            if (!check.ready) {
                console.warn('[wa] posting cycle: client not ready, attempting reconnect for user', userId);

                try {
                    const saved = await redis.get(`${waSessionKey}${userId}`).catch(() => null);
                    if (!saved) {
                        const notify = await redis.get(`${waNotifierChatKey}${userId}`);
                        if (notify) {
                            try {
                                await bot.telegram.sendMessage(
                                    notify,
                                    '⚠️ Scheduled post skipped: no saved WhatsApp session (please /login and scan QR).'
                                );
                            } catch (_) { }
                        }
                        return;
                    }
                } catch (e) {
                    console.error(
                        '[wa] error checking saved session before reconnect',
                        e && e.message ? e.message : e
                    );
                }

                const re = await reconnectClient(userId, RECONNECT_TRIES);
                if (!re) {
                    const notify = await redis.get(`${waNotifierChatKey}${userId}`);
                    if (notify) {
                        try {
                            await bot.telegram.sendMessage(
                                notify,
                                '⚠️ Skipping scheduled post: could not reconnect WhatsApp client. Please check server or run /login.'
                            );
                        } catch (_) { }
                    }
                    return;
                }
                meta = waClients.get(String(userId));
                check = await waitForReadyOrQr(meta, 15000, 500);
                if (!check.ready) {
                    const notify = await redis.get(`${waNotifierChatKey}${userId}`);
                    if (notify) {
                        try {
                            await bot.telegram.sendMessage(
                                notify,
                                '⚠️ Skipping scheduled post: WhatsApp client still not ready after reconnect.'
                            );
                        } catch (_) { }
                    }
                    return;
                }
            }

            const savedPosts = await fetchSavedPostsForUser(userId);
            if (!savedPosts || savedPosts.length === 0) return;
            const selectedGroups = await getUserSelectedGroups(userId);
            if (!selectedGroups || selectedGroups.length === 0) return;

            try {
                await getChatsSafe(meta.client, 10000, 1, 500);
            } catch (e) {
                console.warn(
                    '[wa] getChats quick check failed before posting, attempting reconnect for user',
                    userId,
                    e && e.message ? e.message : e
                );
                const re2 = await reconnectClient(userId, 1);
                if (!re2) {
                    const notify = await redis.get(`${waNotifierChatKey}${userId}`);
                    if (notify) {
                        try {
                            await bot.telegram.sendMessage(
                                notify,
                                '⚠️ Skipping scheduled post: WhatsApp client not responding (getChats failed).'
                            );
                        } catch (_) { }
                    }
                    return;
                }
                meta = waClients.get(String(userId));
            }

            let successes = 0, failures = 0;
            let closedDetected = false;

            outer: for (const gid of selectedGroups) {
                for (const post of savedPosts) {
                    const clientNow =
                        waClients.get(String(userId)) && waClients.get(String(userId)).client;
                    const { ok, closed } = await sendMessageToWhatsAppGroup(
                        userId,
                        clientNow,
                        post,
                        gid
                    );
                    if (ok) successes++;
                    else failures++;
                    if (closed) {
                        closedDetected = true;
                        break outer;
                    }
                    await new Promise(r => setTimeout(r, 1200));
                }
            }

            const notify = await redis.get(`${waNotifierChatKey}${userId}`);
            if (!notify) return;
            if (closedDetected) {
                try {
                    await bot.telegram.sendMessage(
                        notify,
                        '⚠️ Scheduled posting aborted: WhatsApp session/page is closed. ' +
                        'Attempted reconnect. If posting does not resume, please /login and scan QR.'
                    );
                } catch (_) { }
                return;
            }
            try {
                await bot.telegram.sendMessage(
                    notify,
                    `Scheduled posting completed. Success: ${successes}, Failures: ${failures}`
                );
            } catch (_) { }
        } catch (e) {
            console.error('[wa] performPostingCycleForUser error for', userId, e && e.message ? e.message : e);
        }
    }

    async function scheduleIntervalJobForUser(userId) {
        try {
            const key = String(userId);
            if (scheduledJobs.has(key)) {
                try {
                    const obj = scheduledJobs.get(key);
                    if (obj && obj.timer) clearInterval(obj.timer);
                } catch (e) { }
                scheduledJobs.delete(key);
            }

            let raw = await redis.get(`${waIntervalMinutesKey}${userId}`);
            let minutes;
            if (!raw) {
                minutes = DEFAULT_INTERVAL_MINUTES;
                try {
                    await redis.set(`${waIntervalMinutesKey}${userId}`, String(minutes));
                } catch (e) { }
            } else {
                const parsed = parseInt(raw, 10);
                if (isNaN(parsed)) minutes = DEFAULT_INTERVAL_MINUTES;
                else minutes = clampIntervalMinutes(parsed);
            }

            const ms = minutes * 60 * 1000;

            const timer = setInterval(async () => {
                console.log(`[wa] Interval job triggered for user ${userId} (every ${minutes} min)`);
                await performPostingCycleForUser(userId);
            }, ms);

            scheduledJobs.set(key, { timer, minutes });
            console.log(`[wa] scheduled interval job for ${userId} every ${minutes} minute(s)`);
            return true;
        } catch (e) {
            console.error('[wa] scheduleIntervalJobForUser error:', e && e.message ? e.message : e);
            return false;
        }
    }

    // ---------- Telegram commands ----------

    bot.start(async (ctx) => {
        try {
            await ctx.reply('This bot is made by @Professional_telegram_bot_create');
        } catch (e) {
            console.error('/start error:', e && e.message ? e.message : e);
        }
    });

    bot.command('login', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            await redis.set(`${waitingForPasswordPrefix}${userId}`, 'true', 'EX', 300);
            await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
            try { await forceResetUserClient(userId); } catch (e) {
                console.error('[wa] forceResetUserClient on /login err', e && e.message ? e.message : e);
            }
            await ctx.reply('Enter the password to proceed.');
        } catch (e) {
            console.error('/login error:', e && e.message ? e.message : e);
            try { await ctx.reply('An error occurred. Try again.'); } catch (_) { }
        }
    });

    bot.command('logout', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            const key = String(userId);
            const meta = waClients.get(key);
            if (meta && meta.client) {
                try { await meta.client.destroy(); } catch (e) {
                    console.error('[wa] error destroying client on /logout', e && e.message ? e.message : e);
                }
            }
            waClients.delete(key);
            try {
                await redis.del(`${waSessionKey}${userId}`);
                await redis.del(`${waNotifierChatKey}${userId}`);
                await redis.del(`${qrAttemptsKeyPrefix}${userId}`);
            } catch (e) { }
            if (scheduledJobs.has(key)) {
                try {
                    const obj = scheduledJobs.get(key);
                    if (obj && obj.timer) clearInterval(obj.timer);
                } catch (e) { }
                scheduledJobs.delete(key);
            }
            try { removeCacheDir(userId); } catch (_) { }
            await ctx.reply('Logged out from WhatsApp for this Telegram account. To login again, use /login.');
        } catch (e) {
            console.error('/logout error:', e && e.message ? e.message : e);
            try { await ctx.reply('An error occurred while logging out.'); } catch (_) { }
        }
    });

    bot.command('setgroups', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return ctx.reply('Use /login first and provide password.');

            const meta = ensureWAClientForUser(userId);
            await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);

            let readyCheck = meta && meta.ready;
            if (!readyCheck) {
                const saved = await redis.get(`${waSessionKey}${userId}`).catch(() => null);
                if (saved) {
                    const re = await reconnectClient(userId, 1);
                    if (re) readyCheck = true;
                } else {
                    readyCheck = false;
                }
            }

            let attempts = 0;
            try {
                attempts = parseInt(await redis.get(`${qrAttemptsKeyPrefix}${userId}`) || '0', 10) || 0;
            } catch (e) { attempts = 0; }

            if (!readyCheck) {
                if (attempts >= MAX_QR_ATTEMPTS) {
                    await ctx.reply(
                        `QR attempts exhausted (${attempts}/${MAX_QR_ATTEMPTS}). Please run /login again to request a new QR and then /setgroups.`
                    );
                } else {
                    await ctx.reply(
                        'WhatsApp client not ready yet. Please use /login and scan the QR sent in this chat, then run /setgroups.'
                    );
                }
                return;
            }

            if (!meta.client) {
                await ctx.reply('WhatsApp client object not available. Try /login again.');
                return;
            }

            let chats;
            try {
                chats = await getChatsSafe(meta.client, 20000, 2, 1000);
            } catch (e) {
                const msg = e && e.message ? e.message : String(e);
                console.error('/setgroups getChatsSafe error:', msg);

                const re = await reconnectClient(userId, 1);
                if (re) {
                    const newMeta = waClients.get(String(userId));
                    try {
                        chats = await getChatsSafe(newMeta.client, 20000, 2, 1000);
                    } catch (e2) {
                        console.error(
                            '/setgroups retry getChats failed',
                            e2 && e2.message ? e2.message : e2
                        );
                        await ctx.reply(
                            'Failed to fetch WhatsApp chats after reconnect. Try /login again if problem persists.'
                        );
                        return;
                    }
                } else {
                    await ctx.reply('Failed to fetch WhatsApp chats (timeout or error). Try again later.');
                    return;
                }
            }

            const groups = chats
                .filter(c => c.isGroup && c.name)
                .map(g => ({ id: g.id._serialized, name: g.name }));

            if (!groups || groups.length === 0) {
                await ctx.reply('No groups found in this WhatsApp account.');
                return;
            }

            const selected = await getUserSelectedGroups(userId);
            const keyboard = [];
            for (const g of groups) {
                const checked = selected.includes(g.id) ? '✅ ' : '';
                keyboard.push([{ text: `${checked}${g.name}`, callback_data: `wa_toggle|${userId}|${g.id}` }]);
            }
            keyboard.push([{ text: '✅ Done', callback_data: `wa_done|${userId}` }]);

            await ctx.reply('Select groups (toggle):', { reply_markup: { inline_keyboard: keyboard } });
        } catch (e) {
            console.error('/setgroups handler error:', e && e.message ? e.message : e);
            try { await ctx.reply('An error occurred while processing /setgroups.'); } catch (_) { }
        }
    });

    bot.command('settime', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            await redis.set(`${waitingForTimePrefix}${userId}`, 'true', 'EX', 3600);
            await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
            await ctx.reply('Please send the interval in minutes between posts (3-4320).');
        } catch (e) {
            console.error('/settime error:', e && e.message ? e.message : e);
            try { await ctx.reply('An error occurred.'); } catch (_) { }
        }
    });

    bot.command('save', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            await redis.set(`${waitingForPostPrefix}${userId}`, 'true', 'EX', 3600);
            await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
            await ctx.reply(
                'Send the post (photo, video, document, audio, voice, sticker, or text). I will save it for scheduled posting.'
            );
        } catch (e) {
            console.error('/save error:', e && e.message ? e.message : e);
            try { await ctx.reply('An error occurred.'); } catch (_) { }
        }
    });

    bot.command('listposts', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            const arr = await redis.lrange(`${waSavedPostsKey}${userId}`, 0, -1);
            const count = arr ? arr.length : 0;
            await ctx.reply(`You have ${count} saved post(s). Use /save to add more or /clearposts to remove all.`);
        } catch (e) {
            console.error('/listposts error:', e && e.message ? e.message : e);
            try { await ctx.reply('Error fetching posts.'); } catch (_) { }
        }
    });

    bot.command('clearposts', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            await redis.del(`${waSavedPostsKey}${userId}`);
            await ctx.reply('All saved posts cleared.');
        } catch (e) {
            console.error('/clearposts error:', e && e.message ? e.message : e);
            try { await ctx.reply('Error clearing posts.'); } catch (_) { }
        }
    });

    bot.command('wa_status', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            const meta = waClients.get(String(userId));
            const ready = meta && meta.ready;
            const qr = meta && meta.qr ? 'available' : 'none';
            const selected = await getUserSelectedGroups(userId);
            const posts = await redis.lrange(`${waSavedPostsKey}${userId}`, 0, -1).catch(() => []);
            const interval = await redis.get(`${waIntervalMinutesKey}${userId}`);
            const attempts = await redis.get(`${qrAttemptsKeyPrefix}${userId}`).catch(() => null);
            const jobObj = scheduledJobs.get(String(userId));
            const scheduled = jobObj ? `every ${jobObj.minutes} minute(s)` : 'not scheduled';
            const cacheDir = meta && meta.cacheDir ? meta.cacheDir : getCacheDirForUser(userId);
            await ctx.reply(
                `WA status:\nconnected: ${ready}\nqr: ${qr}\nqr_attempts: ${attempts || 0}/${MAX_QR_ATTEMPTS}` +
                `\nselected_groups: ${selected.length}\nsaved_posts: ${posts.length}` +
                `\ninterval_minutes: ${interval || DEFAULT_INTERVAL_MINUTES}\nscheduled: ${scheduled}` +
                `\ncache_dir: ${cacheDir}`
            );
        } catch (e) {
            console.error('/wa_status error:', e && e.message ? e.message : e);
            try { await ctx.reply('Error fetching WA status.'); } catch (_) { }
        }
    });

    // ---------- callback_query handlers ----------

    bot.on('callback_query', async (ctx) => {
        try {
            const data = ctx.callbackQuery && ctx.callbackQuery.data;
            if (!data) return;

            if (data.startsWith('wa_toggle|')) {
                const parts = data.split('|');
                const targetUser = parts[1];
                const groupId = parts[2];
                const userId = ctx.callbackQuery.from && ctx.callbackQuery.from.id;
                if (String(userId) !== String(targetUser)) {
                    return ctx.answerCbQuery('This selection is for another user.');
                }
                const selected = await getUserSelectedGroups(userId);
                const idx = selected.indexOf(groupId);
                if (idx === -1) selected.push(groupId);
                else selected.splice(idx, 1);
                await setUserSelectedGroups(userId, selected);
                await ctx.answerCbQuery('Toggled.');
                try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) { }
                await ctx.reply('Selection updated. (Tip: run /setgroups to view again)');
                return;
            }

            if (data.startsWith('wa_done|')) {
                const parts = data.split('|');
                const targetUser = parts[1];
                const userId = ctx.callbackQuery.from && ctx.callbackQuery.from.id;
                if (String(userId) !== String(targetUser)) {
                    return ctx.answerCbQuery('This is for another user.');
                }
                const selected = await getUserSelectedGroups(userId);
                await ctx.answerCbQuery(`Saved ${selected.length} group(s).`);
                try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (_) { }
                await ctx.reply('Group selection saved.');
                try {
                    await scheduleIntervalJobForUser(userId);
                } catch (e) {
                    console.error(
                        '[wa] scheduleIntervalJobForUser error after wa_done',
                        e && e.message ? e.message : e
                    );
                }
                return;
            }

            if (data.startsWith('save_yes') || data.startsWith('save_no')) {
                const parts = data.split('|');
                const action = parts[0];
                const targetUser = parts[1];
                const userId = ctx.callbackQuery.from && ctx.callbackQuery.from.id;
                if (String(userId) !== String(targetUser)) {
                    return ctx.answerCbQuery('Action not for you.');
                }

                if (action === 'save_yes') {
                    const pending = await redis.get(`${pendingPostPrefix}${userId}`);
                    if (!pending) {
                        await ctx.answerCbQuery('No pending post found.');
                        try { await ctx.editMessageText('No post found to save.'); } catch (_) { }
                        return;
                    }
                    await addSavedPostForUser(userId, JSON.parse(pending));
                    await redis.del(`${pendingPostPrefix}${userId}`);
                    await ctx.answerCbQuery('Saved.');
                    try { await ctx.editMessageText('Post saved!'); } catch (_) { }
                    return;
                } else {
                    await redis.del(`${pendingPostPrefix}${userId}`);
                    await ctx.answerCbQuery('Not saved.');
                    try { await ctx.editMessageText('Post not saved.'); } catch (_) { }
                    return;
                }
            }
        } catch (e) {
            console.error('callback_query error:', e && e.message ? e.message : e);
            try { await ctx.answerCbQuery('Error processing action.'); } catch (_) { }
        }
    });

    // ---------- message handler ----------

    bot.on('message', async (ctx, next) => {
        const userId = ctx.from && ctx.from.id;
        if (!userId) return next();
        try {
            const waitingPwd = await redis.get(`${waitingForPasswordPrefix}${userId}`);
            if (waitingPwd) {
                await redis.del(`${waitingForPasswordPrefix}${userId}`);
                const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';

                if (text === ADMIN_PASSWORD) {
                    try { await forceResetUserClient(userId); } catch (e) {
                        console.error(
                            '[wa] error destroying old client before new login',
                            e && e.message ? e.message : e
                        );
                    }

                    try {
                        await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
                        await redis.set(`${qrAttemptsKeyPrefix}${userId}`, '0', 'EX', QR_ATTEMPT_TTL);
                    } catch (e) {
                        console.error('[wa] error setting notifier/qr attempts', e && e.message ? e.message : e);
                    }

                    try { ensureWAClientForUser(userId); } catch (e) {
                        console.error(
                            '[wa] ensureWAClientForUser error after password accept',
                            e && e.message ? e.message : e
                        );
                    }

                    try {
                        await ctx.reply(
                            '✅ Password accepted.\n' +
                            'WhatsApp client ko naye se start kar raha hoon.\n' +
                            'Agar kuch hi der me QR na aaye, to /setgroups ya /wa_status se status check karo.'
                        );
                    } catch (_) { }
                } else {
                    try { await ctx.reply('❌ Wrong password.'); } catch (_) { }
                }
                return;
            }

            const waitingPost = await redis.get(`${waitingForPostPrefix}${userId}`);
            if (waitingPost) {
                await redis.del(`${waitingForPostPrefix}${userId}`);
                const allowed = ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'text', 'caption'];
                const hasSupported = allowed.some(type => ctx.message && ctx.message[type]);
                const isMediaWithCaption =
                    ctx.message &&
                    (ctx.message.photo ||
                        ctx.message.video ||
                        ctx.message.document ||
                        ctx.message.audio ||
                        ctx.message.voice);
                if (!hasSupported && !isMediaWithCaption) {
                    await ctx.reply(
                        'Unsupported message type. Please send a photo, video, document, audio, voice, sticker, or text.'
                    );
                    return;
                }
                const messageJson = ctx.message;
                await redis.set(`${pendingPostPrefix}${userId}`, JSON.stringify(messageJson), 'EX', 3600);
                try {
                    const copied = await ctx.telegram.copyMessage(
                        ctx.chat.id,
                        ctx.chat.id,
                        ctx.message.message_id
                    );
                    const previewMsgId = copied && copied.message_id ? copied.message_id : null;
                    await ctx.reply('Do you want to save this post?', {
                        reply_to_message_id: previewMsgId,
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: 'Yes', callback_data: `save_yes|${userId}` },
                                    { text: 'No', callback_data: `save_no|${userId}` },
                                ],
                            ],
                        },
                    });
                } catch (e) {
                    try {
                        await ctx.reply(
                            'Do you want to save this post? Reply with Yes/No or use the inline keyboard if available.'
                        );
                    } catch (_) { }
                }
                return;
            }

            const waitingTime = await redis.get(`${waitingForTimePrefix}${userId}`);
            if (waitingTime) {
                await redis.del(`${waitingForTimePrefix}${userId}`);
                const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
                const parsed = parseInt(text, 10);
                if (isNaN(parsed)) {
                    await ctx.reply(
                        `Invalid number. Please send an integer between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`
                    );
                    return;
                }
                const minutes = clampIntervalMinutes(parsed);
                if (minutes !== parsed) {
                    await ctx.reply(
                        `Interval adjusted to ${minutes} minute(s) (allowed range ${MIN_INTERVAL_MINUTES}-${MAX_INTERVAL_MINUTES}).`
                    );
                } else {
                    await ctx.reply(`Interval set to ${minutes} minute(s).`);
                }

                try {
                    await redis.set(`${waIntervalMinutesKey}${userId}`, String(minutes));
                    await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
                    await scheduleIntervalJobForUser(userId);
                } catch (e) {
                    console.error('[wa] error saving interval/scheduling', e && e.message ? e.message : e);
                }
                return;
            }
        } catch (e) {
            console.error('[message] workflow error:', e && e.message ? e.message : e);
        } finally {
            try { await next(); } catch (_) { }
        }
    });

    // ---------- graceful shutdown ----------

    function shutdownAll() {
        for (const [, meta] of waClients.entries()) {
            try {
                if (meta.qrTimeout) {
                    try { clearTimeout(meta.qrTimeout); } catch (_) { }
                    meta.qrTimeout = null;
                }
                if (meta.client) {
                    try { meta.client.destroy(); } catch (_) { }
                }
            } catch (_) { }
        }
        for (const [, jobObj] of scheduledJobs.entries()) {
            try {
                if (jobObj && jobObj.timer) clearInterval(jobObj.timer);
            } catch (_) { }
        }
        console.log('[wa] shutdown completed');
    }

    process.once('SIGINT', shutdownAll);
    process.once('SIGTERM', shutdownAll);
};