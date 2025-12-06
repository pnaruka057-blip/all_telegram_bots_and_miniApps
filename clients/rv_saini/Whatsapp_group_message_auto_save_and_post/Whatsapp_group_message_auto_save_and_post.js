'use strict';

/**
 * telegram-whatsapp-auto-post-redis.js
 *
 * - Saara state Redis me (WhatsApp session, selected groups, saved posts, schedule time, notifier chat, QR attempts)
 * - /login + password se WhatsApp login (QR max 2 attempts per login cycle)
 * - /logout se current Telegram user ka WhatsApp session destroy
 * - /setgroups fast hai (no long wait) → Railway/Grammy 90s timeout ke bahar
 * - Cron se daily auto-post (Asia/Kolkata)
 *
 * WARNING: Unofficial WhatsApp automation se account ban ka risk hota hai.
 * Use sirf apne personal / test accounts par.
 */

const qrcode = require('qrcode');
const axios = require('axios');
const { Client, MessageMedia } = require('whatsapp-web.js');
const cron = require('node-cron');

// your redis module (promise based)
const redis = require('../../../globle_helper/redisConfig');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST || 'changeme';
const TZ = 'Asia/Kolkata';
const maxSavedPosts = Number(process.env.WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST_MAX_POST) || 10;

// QR limit per login cycle
const MAX_QR_ATTEMPTS = 2;
const QR_ATTEMPT_TTL = 60 * 60; // 1 hour (seconds)

// global error safety
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
    const waScheduleTimeKey = `${prefix}schedule_time:`;             // + userId
    const waNotifierChatKey = `${prefix}notifier_chat:`;             // + userId
    const pendingPostPrefix = `${prefix}pending_post:`;              // + userId
    const waitingForPostPrefix = `${prefix}waiting_for_post:`;       // + userId
    const waitingForTimePrefix = `${prefix}waiting_for_time:`;       // + userId
    const qrAttemptsKeyPrefix = `${prefix}qr_attempts:`;             // + userId

    const waClients = new Map();       // userId -> meta
    const scheduledJobs = new Map();   // userId -> cron job

    // ---------- helpers: time parsing & cron ----------

    function parseTimeInput(input) {
        if (!input || typeof input !== 'string') return null;
        let s = input.trim().toUpperCase().replace(/\s+/g, '');
        const ampmMatch = s.match(/([AP]M)$/);
        if (ampmMatch) {
            const ampm = ampmMatch[1];
            s = s.replace(/[AP]M$/, '');
            if (!s.includes(':')) {
                if (s.length === 3 || s.length === 4) {
                    const hh = s.slice(0, s.length - 2);
                    const mm = s.slice(-2);
                    s = `${hh}:${mm}`;
                } else s = `${s}:00`;
            }
            const [hhRaw, mmRaw] = s.split(':');
            let hh = parseInt(hhRaw, 10);
            const mm = parseInt(mmRaw || '0', 10);
            if (isNaN(hh) || isNaN(mm) || hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;
            if (ampm === 'PM' && hh !== 12) hh += 12;
            if (ampm === 'AM' && hh === 12) hh = 0;
            return { hour: hh, minute: mm, str: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
        } else {
            if (!s.includes(':')) s = `${s}:00`;
            const [hhRaw, mmRaw] = s.split(':');
            const hh = parseInt(hhRaw, 10);
            const mm = parseInt(mmRaw || '0', 10);
            if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
            return { hour: hh, minute: mm, str: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
        }
    }

    function cronExpressionForTime(hour, minute) {
        return `${minute} ${hour} * * *`;
    }

    // background me WA ready/QR ka wait — sirf cron job ke liye, Telegram update ke andar nahi
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

    /**
     * getChatsSafe: few retries + timeout per try
     */
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
                console.warn(
                    `[wa] getChats attempt ${attempt} failed:`,
                    err && err.message ? err.message : err
                );
                if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
                else throw err;
            }
        }
    }

    /**
     * ensureWAClientForUser: WhatsApp client create/reuse with Redis session
     * Container-friendly puppeteer options (Railway/Render/etc).
     */
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
        };
        waClients.set(key, meta);

        meta.initPromise = (async () => {
            try {
                meta.initError = false;
                meta.initErrorMsg = null;
                meta.qrLimitNotified = false;

                // session from redis
                let sessionObj = null;
                try {
                    const raw = await redis.get(`${waSessionKey}${userId}`);
                    if (raw) sessionObj = JSON.parse(raw);
                } catch (e) {
                    console.warn('[wa] failed to read session from redis', e && e.message ? e.message : e);
                }

                // ensure QR attempts key
                try {
                    const attemptsKey = `${qrAttemptsKeyPrefix}${userId}`;
                    const existing = await redis.get(attemptsKey);
                    if (!existing) await redis.set(attemptsKey, '0', 'EX', QR_ATTEMPT_TTL);
                } catch (e) { /* ignore */ }

                // puppeteer options: container friendly
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
                    },
                };

                // optional executablePath from env (Railway / custom Chromium)
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

                // QR handler
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
                                const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                                if (notifier) {
                                    await bot.telegram.sendMessage(
                                        notifier,
                                        `QR send limit reached (${MAX_QR_ATTEMPTS}). Please run /login again.`
                                    );
                                }
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
                            await bot.telegram.sendPhoto(
                                notifier,
                                { source: buffer },
                                { caption: `Scan this QR (attempt ${attempts + 1}/${MAX_QR_ATTEMPTS})` }
                            );
                        }

                        // increment attempts
                        try {
                            await redis.set(`${qrAttemptsKeyPrefix}${userId}`, String(attempts + 1), 'EX', QR_ATTEMPT_TTL);
                        } catch (e) { /* ignore */ }
                    } catch (e) {
                        console.error('[wa] qr handler error', e && e.message ? e.message : e);
                    }
                });

                // authenticated -> session save
                client.on('authenticated', async (session) => {
                    try {
                        await redis.set(`${waSessionKey}${userId}`, JSON.stringify(session));
                        await redis.del(`${qrAttemptsKeyPrefix}${userId}`).catch(() => null);
                        meta.qrLimitNotified = false;
                        console.log(`[wa] authenticated and saved session to redis for user ${userId}`);
                    } catch (e) {
                        console.error('[wa] saving session to redis failed:', e && e.message ? e.message : e);
                    }
                });

                // ready
                client.on('ready', async () => {
                    meta.ready = true;
                    console.log(`[wa] client ready for user ${userId}`);
                    try {
                        const notifier = await redis.get(`${waNotifierChatKey}${userId}`).catch(() => null);
                        if (notifier) await bot.telegram.sendMessage(notifier, 'WhatsApp connected and ready.');
                    } catch (e) { /* ignore */ }
                });

                client.on('auth_failure', (msg) => {
                    meta.initError = true;
                    meta.initErrorMsg = msg && msg.message ? msg.message : String(msg);
                    console.error(`[wa] auth failure for user ${userId}:`, msg);
                });

                client.on('disconnected', async (reason) => {
                    meta.ready = false;
                    console.warn(`[wa] disconnected for user ${userId}:`, reason);
                    await redis.del(`${waSessionKey}${userId}`).catch(() => null);
                    try { await client.destroy(); } catch (_) { }
                    waClients.delete(key);
                });

                // initialize
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

    // ---------- Redis helpers for user data ----------

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
                .map(x => { try { return JSON.parse(x); } catch (e) { return null; } })
                .filter(Boolean);
        } catch (e) {
            console.error('[wa] fetchSavedPostsForUser error:', e && e.message ? e.message : e);
            return [];
        }
    }

    async function sendMessageToWhatsAppGroup(client, savedMsg, groupId) {
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
                return true;
            }

            if (savedMsg.video) {
                const fileId = savedMsg.video.file_id;
                const fileUrl = await bot.telegram.getFileLink(fileId);
                const buffer = (await axios.get(fileUrl.href, { responseType: 'arraybuffer' })).data;
                const base64 = buffer.toString('base64');
                const mime = savedMsg.video.mime_type || 'video/mp4';
                const media = new MessageMedia(mime, base64);
                await client.sendMessage(groupId, media, { caption: savedMsg.caption || '' });
                return true;
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
                return true;
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
                return true;
            }

            if (savedMsg.text || savedMsg.caption) {
                const text = savedMsg.text || savedMsg.caption || '';
                await client.sendMessage(groupId, text);
                return true;
            }

            console.log('[wa] unsupported saved message type', savedMsg);
            return false;
        } catch (e) {
            console.error('[wa] sendMessageToWhatsAppGroup error:', e && e.message ? e.message : e);
            return false;
        }
    }

    async function scheduleDailyJobForUser(userId) {
        try {
            const raw = await redis.get(`${waScheduleTimeKey}${userId}`);
            if (!raw) {
                if (scheduledJobs.has(String(userId))) {
                    try { scheduledJobs.get(String(userId)).stop(); } catch (e) { }
                    scheduledJobs.delete(String(userId));
                }
                return;
            }
            const parsed = parseTimeInput(raw);
            if (!parsed) {
                console.warn('[wa] invalid stored schedule for', userId, raw);
                return;
            }
            const cronExpr = cronExpressionForTime(parsed.hour, parsed.minute);

            if (scheduledJobs.has(String(userId))) {
                try { scheduledJobs.get(String(userId)).stop(); } catch (e) { }
                scheduledJobs.delete(String(userId));
            }

            const job = cron.schedule(cronExpr, async () => {
                console.log(`[wa] Running scheduled job for user ${userId} at ${parsed.str}`);
                try {
                    const meta = ensureWAClientForUser(userId);
                    const check = await waitForReadyOrQr(meta, 20000, 500);
                    if (!check.ready) {
                        const chat = await redis.get(`${waNotifierChatKey}${userId}`);
                        if (chat) {
                            await bot.telegram.sendMessage(
                                chat,
                                `Skipping scheduled post: WhatsApp client not ready (${check.error || 'not ready'}).`
                            );
                        }
                        return;
                    }

                    const savedPosts = await fetchSavedPostsForUser(userId);
                    if (!savedPosts || savedPosts.length === 0) return;

                    const selectedGroups = await getUserSelectedGroups(userId);
                    if (!selectedGroups || selectedGroups.length === 0) return;

                    let successes = 0, failures = 0;
                    for (const gid of selectedGroups) {
                        for (const post of savedPosts) {
                            const ok = await sendMessageToWhatsAppGroup(meta.client, post, gid);
                            if (ok) successes++; else failures++;
                            await new Promise(r => setTimeout(r, 1200));
                        }
                    }

                    const notify = await redis.get(`${waNotifierChatKey}${userId}`);
                    if (notify) {
                        await bot.telegram.sendMessage(
                            notify,
                            `Scheduled posting completed. Success: ${successes}, Failures: ${failures}`
                        );
                    }
                } catch (e) {
                    console.error('[wa] scheduled job error for', userId, e && e.message ? e.message : e);
                }
            }, { timezone: TZ });

            scheduledJobs.set(String(userId), job);
            console.log(`[wa] scheduled daily job for ${userId} at ${parsed.str} (${cronExpr})`);
        } catch (e) {
            console.error('[wa] scheduleDailyJobForUser error:', e && e.message ? e.message : e);
        }
    }

    // ---------- Telegram bot commands ----------

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
            await redis.set(`${qrAttemptsKeyPrefix}${userId}`, '0', 'EX', QR_ATTEMPT_TTL);
            await ctx.reply('Enter the password to proceed.');
        } catch (e) {
            console.error('/login error:', e && e.message ? e.message : e);
            await ctx.reply('An error occurred. Try again.');
        }
    });

    bot.command('logout', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            const key = String(userId);
            const meta = waClients.get(key);
            if (meta && meta.client) {
                try { await meta.client.destroy(); } catch (e) { }
            }
            waClients.delete(key);

            try {
                await redis.del(`${waSessionKey}${userId}`);
                await redis.del(`${waNotifierChatKey}${userId}`);
                await redis.del(`${qrAttemptsKeyPrefix}${userId}`);
            } catch (e) { /* ignore */ }

            if (scheduledJobs.has(key)) {
                try { scheduledJobs.get(key).stop(); } catch (e) { }
                scheduledJobs.delete(key);
            }

            await ctx.reply('Logged out from WhatsApp for this Telegram account. To login again, use /login.');
        } catch (e) {
            console.error('/logout error:', e && e.message ? e.message : e);
            await ctx.reply('An error occurred while logging out.');
        }
    });

    // IMPORTANT: /setgroups fast (no long waiting)
    bot.command('setgroups', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return ctx.reply('Use /login first and provide password.');

            const meta = ensureWAClientForUser(userId);
            await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);

            let attempts = 0;
            try {
                attempts = parseInt(await redis.get(`${qrAttemptsKeyPrefix}${userId}`) || '0', 10) || 0;
            } catch (e) {
                attempts = 0;
            }

            // If WA not ready yet
            if (!meta.ready) {
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

            // WA ready → fetch chats with our own timeout+retries
            let chats;
            try {
                chats = await getChatsSafe(meta.client, 20000, 2, 1000);
            } catch (e) {
                console.error('/setgroups getChatsSafe error:', e && e.message ? e.message : e);
                await ctx.reply('Failed to fetch WhatsApp chats (timeout or error). Try again later.');
                return;
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
            await ctx.reply('Send daily time for auto post (examples: "10:12AM", "22:12", "9:05 PM").');
        } catch (e) {
            console.error('/settime error:', e && e.message ? e.message : e);
            await ctx.reply('An error occurred.');
        }
    });

    bot.command('save', async (ctx) => {
        try {
            const userId = ctx.from && ctx.from.id;
            if (!userId) return;
            await redis.set(`${waitingForPostPrefix}${userId}`, 'true', 'EX', 3600);
            await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
            await ctx.reply('Send the post (photo, video, document, audio, voice, sticker, or text). I will save it for scheduled posting.');
        } catch (e) {
            console.error('/save error:', e && e.message ? e.message : e);
            await ctx.reply('An error occurred.');
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
            await ctx.reply('Error fetching posts.');
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
            await ctx.reply('Error clearing posts.');
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
            const time = await redis.get(`${waScheduleTimeKey}${userId}`);
            const attempts = await redis.get(`${qrAttemptsKeyPrefix}${userId}`).catch(() => null);
            await ctx.reply(
                `WA status:\nconnected: ${ready}\nqr: ${qr}\nqr_attempts: ${attempts || 0}/${MAX_QR_ATTEMPTS}\nselected_groups: ${selected.length}\nsaved_posts: ${posts.length}\nschedule: ${time || 'not set'}`
            );
        } catch (e) {
            console.error('/wa_status error:', e && e.message ? e.message : e);
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
                await scheduleDailyJobForUser(userId);
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

    // ---------- message handler (password, post, time) ----------

    bot.on('message', async (ctx, next) => {
        const userId = ctx.from && ctx.from.id;
        if (!userId) return next();
        try {
            // password flow
            const waitingPwd = await redis.get(`${waitingForPasswordPrefix}${userId}`);
            if (waitingPwd) {
                await redis.del(`${waitingForPasswordPrefix}${userId}`);
                const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
                if (text === ADMIN_PASSWORD) {
                    await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
                    await redis.set(`${qrAttemptsKeyPrefix}${userId}`, '0', 'EX', QR_ATTEMPT_TTL);
                    ensureWAClientForUser(userId);
                    await ctx.reply(
                        'Password accepted. I\'m starting WhatsApp client. If you do not get a QR in this chat, wait a bit and run /setgroups or /login again. When QR appears, scan it from your WhatsApp app.'
                    );
                } else {
                    await ctx.reply('Wrong password.');
                }
                return;
            }

            // saving post flow
            const waitingPost = await redis.get(`${waitingForPostPrefix}${userId}`);
            if (waitingPost) {
                await redis.del(`${waitingForPostPrefix}${userId}`);
                const allowed = ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'text', 'caption'];
                const hasSupported = allowed.some(type => ctx.message && ctx.message[type]);
                const isMediaWithCaption = ctx.message && (
                    ctx.message.photo ||
                    ctx.message.video ||
                    ctx.message.document ||
                    ctx.message.audio ||
                    ctx.message.voice
                );
                if (!hasSupported && !isMediaWithCaption) {
                    await ctx.reply('Unsupported message type. Please send a photo, video, document, audio, voice, sticker, or text.');
                    return;
                }
                const messageJson = ctx.message;
                await redis.set(`${pendingPostPrefix}${userId}`, JSON.stringify(messageJson), 'EX', 3600);
                try {
                    const copied = await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, ctx.message.message_id);
                    const previewMsgId = copied && copied.message_id ? copied.message_id : null;
                    await ctx.reply('Do you want to save this post?', {
                        reply_to_message_id: previewMsgId,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: 'Yes', callback_data: `save_yes|${userId}` }, { text: 'No', callback_data: `save_no|${userId}` }]
                            ]
                        }
                    });
                } catch (e) {
                    await ctx.reply('Do you want to save this post? Reply with Yes/No or use the inline keyboard if available.');
                }
                return;
            }

            // time setting flow
            const waitingTime = await redis.get(`${waitingForTimePrefix}${userId}`);
            if (waitingTime) {
                await redis.del(`${waitingForTimePrefix}${userId}`);
                const text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
                const parsed = parseTimeInput(text);
                if (!parsed) {
                    await ctx.reply('Invalid time. Examples: "10:12AM", "22:12", "9:05 PM".');
                    return;
                }
                await redis.set(`${waScheduleTimeKey}${userId}`, parsed.str);
                await redis.set(`${waNotifierChatKey}${userId}`, String(ctx.chat.id), 'EX', 86400 * 30);
                await ctx.reply(`✅ Scheduled daily posts at ${parsed.str} (${TZ}).`);
                await scheduleDailyJobForUser(userId);
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
        for (const [uid, meta] of waClients.entries()) {
            try { if (meta.client) meta.client.destroy(); } catch (e) { }
        }
        for (const [uid, job] of scheduledJobs.entries()) {
            try { job.stop(); } catch (e) { }
        }
        console.log('[wa] shutdown completed');
    }

    process.once('SIGINT', shutdownAll);
    process.once('SIGTERM', shutdownAll);
};