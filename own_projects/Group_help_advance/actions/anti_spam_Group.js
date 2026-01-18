const user_setting_module = require("../models/user_settings_module");
const messages_module = require("../models/messages_module");

module.exports = (bot) => {
    const escapeHTML = (s) =>
        String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

    const mentionHTML = (u) => {
        const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || "User";
        return `<a href="tg://user?id=${Number(u?.id)}">${escapeHTML(name)}</a>`;
    };


    async function storeBotServiceMessage({ ownerDoc, chatIdStr, chatId, sentMessageId }) {
        const DEFAULT_TTL_MS = 10 * 60 * 1000;
        try {
            if (!ownerDoc?._id || !sentMessageId) return;

            // Punishment/warn messages ki delete timing yaha se lo
            const delCfg = ownerDoc?.settings?.[chatIdStr]?.delete_settings?.scheduled?.bot_service

            const enabled = (typeof delCfg?.enabled === "boolean") ? delCfg.enabled : true;

            const ttlMs =
                (typeof delCfg?.time_ms === "number" && delCfg.time_ms > 0) ? delCfg.time_ms : DEFAULT_TTL_MS;

            if (!enabled || ttlMs <= 0) return;

            const now = new Date();
            const deleteAt = new Date(now.getTime() + ttlMs);
            const ttlMinutes = Math.round(ttlMs / 60000);

            await messages_module.updateOne(
                { group_id: Number(chatId), message_id: Number(sentMessageId) },
                {
                    $setOnInsert: { userDB_id: ownerDoc._id },
                    $set: {
                        sent_at: now,
                        delete_at: deleteAt,
                        ttl_minutes: ttlMinutes,
                        type: "bot_service_message",
                        status: "pending",
                    },
                },
                { upsert: true }
            );
        } catch (e) {
            console.error("Error storing bot service message:", e);
        }
    }

    const normalizeLower = (v) => (v == null ? "" : String(v).trim().toLowerCase());

    const PERM_MUTE_UNTIL_MS = Date.now() + 100 * 365 * 24 * 3600 * 1000; // ~100 years

    const handleWarnThenMaybePermanentMute = async ({
        ctx,
        ownerDoc,
        chatIdStr,
        offenderId,
        delete_messages,
        reason,
        warnDurationMs,
        warnedUsersPath,
        punishedUsersPath,
    }) => {
        const count = await updateWarnCount(ownerDoc, chatIdStr, warnedUsersPath, offenderId, warnDurationMs);

        // 1st / 2nd warn => show warning only
        if (count <= 2) {
            const sent = await applyPenalty(ctx, "warn", 0, delete_messages, {
                message: `${reason}`,
                strikeText: `${count}/3`,
            });
            if (sent?.message_id) {
                await storeBotServiceMessage({
                    ownerDoc,
                    chatIdStr,
                    chatId: ctx.chat.id,
                    sentMessageId: sent.message_id,
                });
            }
            return true;
        }

        // 3rd warn => show final warning (3/3) + then permanent mute
        if (delete_messages) await safeDeleteMessage(ctx);

        const botAdmin = await isBotAdmin(ctx);

        let sent = await applyPenalty(ctx, "warn", 0, false, {
            message: botAdmin
                ? `${reason}\nAction: permanently muted.`
                : `${reason}\nAction: permanent mute would be applied, but the bot is not an admin.`,
            strikeText: `3/3`,
        });

        if (botAdmin) {
            // enforce mute
            send = await applyPenalty(ctx, "mute", 0, false, reason);

            // store punished user for tracking
            await addPunishedUser(ownerDoc, chatIdStr, punishedUsersPath, offenderId, "mute", PERM_MUTE_UNTIL_MS);
        }

        if (sent?.message_id) {
            await storeBotServiceMessage({
                ownerDoc,
                chatIdStr,
                chatId: ctx.chat.id,
                sentMessageId: sent.message_id,
            });
        }

        await resetWarnCount(ownerDoc, chatIdStr, warnedUsersPath, offenderId);
        return true;
    };

    const normalizeWhitelist = (whitelist) => {
        // Schema me whitelist String hai (but sometimes code array treat karta hai),
        // so yahan string/array dono handle.
        if (Array.isArray(whitelist)) {
            return whitelist.map((x) => String(x || "").trim()).filter(Boolean);
        }
        if (typeof whitelist === "string") {
            return whitelist
                .split(/[\n,]+/g)
                .map((x) => x.trim())
                .filter(Boolean);
        }
        return [];
    };

    // Local validator (no helper dependency)
    // Returns normalized "@username" OR "https://t.me/...." OR "tg://user?id=..."
    const validateTelegramLinkOrUsername = (raw) => {
        if (!raw || typeof raw !== "string") return null;

        let s = raw.trim();
        s = s.replace(/^[\{\[]+/, "").replace(/[\}\]]+$/, "").trim();

        // tg://user?id=123
        if (/^tg:\/\/user\?id=\d+$/i.test(s)) return s;

        // username
        const usernameMatch = s.match(/^@?([A-Za-z0-9_]{5,32})$/);
        if (usernameMatch) return "@" + usernameMatch[1];

        // links: t.me / telegram.me / telegram.dog
        const linkMatch = s.match(/^(?:https?:\/\/)?(?:www\.)?(t\.me|telegram\.me|telegram\.dog)\/(.+)$/i);
        if (linkMatch) {
            const host = linkMatch[1].toLowerCase();
            let path = String(linkMatch[2] || "").trim();
            if (!path || /^\/+$/.test(path)) return null;
            path = path.replace(/^\/+/, "");

            // ✅ add this (remove query/hash)
            path = path.split(/[?#]/)[0];

            return `https://${host}/${path}`;
        }

        return null;
    };

    const getChatSettingsOwnerDoc = async (chatIdStr) => {
        try {
            return await user_setting_module.findOne({ [`settings.${chatIdStr}`]: { $exists: true } });
        } catch (e) {
            return null;
        }
    };

    const getChatSettingsFromDoc = (doc, chatIdStr) => {
        if (!doc) return null;
        const s =
            (doc.settings && typeof doc.settings.get === "function" && doc.settings.get(chatIdStr)) ||
            (doc.settings && doc.settings[chatIdStr]) ||
            null;
        return s || null;
    };

    const isUserAdminOrCreator = async (ctx, user_id) => {
        try {
            const m = await ctx.telegram.getChatMember(ctx.chat.id, user_id);
            return m && (m.status === "administrator" || m.status === "creator");
        } catch (e) {
            // Agar yahan fail ho gaya to enforcement stop nahi hona chahiye,
            // isliye "not admin" maan lo.
            return false;
        }
    };

    const isBotAdmin = async (ctx) => {
        try {
            const me = await ctx.telegram.getMe();
            const m = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
            return m && (m.status === "administrator" || m.status === "creator");
        } catch (e) {
            return false;
        }
    };

    const safeDeleteMessage = async (ctx) => {
        try {
            if (!ctx?.chat?.id || !ctx?.message?.message_id) return;
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
        } catch (e) { }
    };

    const ensureArray = (v) => (Array.isArray(v) ? v : []);

    const getTextAndEntities = (msg) => {
        const text = (msg && (msg.text || msg.caption)) || "";
        const entities = (msg && (msg.entities || msg.caption_entities)) || [];
        return { text, entities };
    };

    const extractTelegramTargets = (msg, usernameAntispamEnabled) => {
        const { text, entities } = getTextAndEntities(msg);
        const found = [];

        for (const ent of entities) {
            try {
                if (ent.type === "text_link" && ent.url) {
                    found.push(ent.url);
                } else if (ent.type === "url" && typeof ent.offset === "number" && typeof ent.length === "number") {
                    found.push(text.slice(ent.offset, ent.offset + ent.length));
                } else if (ent.type === "mention" && usernameAntispamEnabled) {
                    found.push(text.slice(ent.offset, ent.offset + ent.length));
                }
            } catch (e) { }
        }

        const reTgLink =
            /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:joinchat\/|[+])?[A-Za-z0-9_/-]{3,}/gi;
        const mLinks = text.match(reTgLink);
        if (mLinks && mLinks.length) found.push(...mLinks);

        if (usernameAntispamEnabled) {
            const reUser = /@([A-Za-z0-9_]{5,32})\b/g;
            let m;
            while ((m = reUser.exec(text)) !== null) found.push(m[0]);
        }

        const unique = [];
        const seen = new Set();
        for (const raw of found) {
            const r = String(raw || "").trim();
            if (!r) continue;
            const key = normalizeLower(r);
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(r);
        }
        return unique;
    };

    const extractAnyLinks = (msg) => {
        const { text, entities } = getTextAndEntities(msg);
        const out = [];

        for (const ent of entities) {
            try {
                if (ent.type === "text_link" && ent.url) out.push(ent.url);
                else if (ent.type === "url" && typeof ent.offset === "number" && typeof ent.length === "number") {
                    out.push(text.slice(ent.offset, ent.offset + ent.length));
                }
            } catch (e) { }
        }

        const re =
            /(?:(?:https?:\/\/|ftp:\/\/)\S+)|(?:www\.\S+)|(?:\b[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?)/gi;
        const m = text.match(re);
        if (m && m.length) out.push(...m);

        const uniq = [];
        const seen = new Set();
        for (const s of out) {
            const v = String(s || "").trim();
            if (!v) continue;
            const k = normalizeLower(v);
            if (seen.has(k)) continue;
            seen.add(k);
            uniq.push(v);
        }
        return uniq;
    };

    // --- Replace these TG whitelist helpers with strict versions ---

    const TG_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);

    const canonicalizeTelegramLink = (norm) => {
        // norm expected from validateTelegramLinkOrUsername => https://<host>/<path>
        if (!norm || typeof norm !== "string") return null;
        if (!norm.startsWith("http")) return null;

        let u;
        try { u = new URL(norm); } catch { return null; }

        const host = (u.hostname || "").toLowerCase().replace(/^www\./i, "");
        if (!TG_HOSTS.has(host)) return null;

        // ignore query/hash (you already strip, but keep it safe)
        let path = (u.pathname || "").trim();
        if (!path || path === "/") return null;

        // normalize: remove trailing slashes
        path = path.replace(/\/+$/, "");

        const segs = path.split("/").filter(Boolean);
        if (segs.length) {
            const first = segs[0];
            const isUsernameSeg = /^[A-Za-z0-9_]{5,32}$/.test(first) && first !== "joinchat" && first !== "c";
            if (isUsernameSeg) segs[0] = first.toLowerCase();
        }

        return `https://t.me/${segs.join("/")}`;
    };

    const buildTgWhitelistSetsStrict = (whitelist) => {
        const usernameSet = new Set();
        const linkSet = new Set();

        for (const raw of normalizeWhitelist(whitelist)) {
            const norm = validateTelegramLinkOrUsername(String(raw || ""));
            if (!norm) continue;

            if (norm.startsWith("@")) {
                usernameSet.add(normalizeLower(norm));
                continue;
            }

            const canon = canonicalizeTelegramLink(norm);
            if (canon) linkSet.add(canon);
        }

        return { usernameSet, linkSet };
    };

    const tgTargetIsWhitelisted = (rawTarget, whitelist) => {
        const norm = validateTelegramLinkOrUsername(String(rawTarget || ""));
        if (!norm) return false;

        const { usernameSet, linkSet } = buildTgWhitelistSetsStrict(whitelist);

        // 1) Username target -> username-only match
        if (norm.startsWith("@")) {
            const u = normalizeLower(norm);
            return usernameSet.has(u);
        }

        // 2) Link target -> link-only match
        const t = canonicalizeTelegramLink(norm);
        if (!t) return false;

        if (linkSet.has(t)) return true;

        for (const base of linkSet) {
            if (t.startsWith(base + "/")) return true;
        }

        return false;
    };

    const linkMatchesWhitelist = (link, whitelist) => {
        const wl = normalizeWhitelist(whitelist);
        const l = normalizeLower(link);

        for (const w of wl) {
            const ww = normalizeLower(w);
            if (!ww) continue;

            if (l === ww) return true;
            if (ww.includes(".") && l.includes(ww)) return true;
        }
        return false;
    };

    const updateWarnCount = async (ownerDoc, chatIdStr, warnedUsersPath, offenderId, warnDurationMs) => {
        const settings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
        if (!settings) return 1;

        const parts = warnedUsersPath.split(".");
        let ref = settings;
        for (let i = 0; i < parts.length - 1; i++) {
            ref[parts[i]] = ref[parts[i]] || {};
            ref = ref[parts[i]];
        }

        const lastKey = parts[parts.length - 1];
        ref[lastKey] = ensureArray(ref[lastKey]);
        const arr = ref[lastKey];

        const now = Date.now();
        const untilMs = now + Math.max(0, Number(warnDurationMs || 0));

        const idx = arr.findIndex((x) => Number(x?.user_id) === Number(offenderId));
        if (idx === -1) {
            arr.push({ user_id: Number(offenderId), count: 1, until_ms: untilMs });
            await ownerDoc.save().catch(() => { });
            return 1;
        }

        const nextCount = Math.min(3, Number(arr[idx].count || 1) + 1);
        arr[idx].count = nextCount;

        arr[idx].until_ms = untilMs;

        await ownerDoc.save().catch(() => { });
        return nextCount;
    };

    const resetWarnCount = async (ownerDoc, chatIdStr, warnedUsersPath, offenderId) => {
        const settings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
        if (!settings) return;

        const parts = warnedUsersPath.split(".");
        let ref = settings;

        // robust traversal (same as updateWarnCount style)
        for (let i = 0; i < parts.length - 1; i++) {
            ref[parts[i]] = ref[parts[i]] || {};
            ref = ref[parts[i]];
        }

        const lastKey = parts[parts.length - 1];
        const arr = ensureArray(ref[lastKey]);

        // ✅ remove offender entry completely user_id
        ref[lastKey] = arr.filter((x) => {
            return Number(x.user_id) !== Number(offenderId);
        });

        await ownerDoc.save().catch(() => { });
    };

    const addPunishedUser = async (ownerDoc, chatIdStr, punishedUsersPath, offenderId, type, untilMs) => {
        const settings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
        if (!settings) return;

        const t = normalizeLower(type);
        if (!(t === "mute" || t === "ban")) return;

        const parts = punishedUsersPath.split(".");
        let ref = settings;
        for (let i = 0; i < parts.length - 1; i++) {
            ref[parts[i]] = ref[parts[i]] || {};
            ref = ref[parts[i]];
        }

        const lastKey = parts[parts.length - 1];
        ref[lastKey] = ensureArray(ref[lastKey]);

        // remove old entry for same user
        ref[lastKey] = ref[lastKey].filter((x) => Number(x?.user_id) !== Number(offenderId));

        ref[lastKey].push({
            user_id: Number(offenderId),
            type: t,
            until_ms: Number(untilMs),
        });

        await ownerDoc.save().catch(() => { });
    };

    // patch applyPenalty
    const applyPenalty = async (ctx, penalty, durationMs, delete_messages, reasonText) => {
        const chatId = ctx.chat?.id;
        const msgId = ctx.message?.message_id;
        const offender = ctx.from;

        // delete first (optional)
        if (delete_messages) await safeDeleteMessage(ctx);

        if (penalty === "off") return;

        // ✅ WARN: never rely on reply_to_message_id if message was deleted
        if (penalty === "warn") {
            try {
                const who = mentionHTML(offender);

                // allow both: string OR { message, strikeText }
                const payload = reasonText;
                const strikeText =
                    (payload && typeof payload === "object" && payload.strikeText)
                        ? String(payload.strikeText)
                        : "1/3";

                const strikeNo = Number(String(strikeText).split("/")[0] || 1);

                const message =
                    (payload && typeof payload === "object")
                        ? String(payload.message || "")
                        : String(payload || "");

                const tail =
                    strikeNo >= 3
                        ? `Please avoid repeating this.`
                        : `\n<i>If this behavior continues, you will be permanently muted.\nPlease avoid repeating this.</i>`;

                const text =
                    `⚠️ Warning (${escapeHTML(strikeText)})\n` +
                    `Hii ${who},\n` +
                    `${escapeHTML(message)}\n` +
                    `${tail}`;

                const extra = {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                };

                // reply only if message still exists
                if (!delete_messages && chatId && msgId) extra.reply_to_message_id = msgId;

                const sent = await ctx.telegram.sendMessage(chatId, text, extra);
                return sent;
            } catch (e) { }
            return;
        }

        // Other actions need admin (unchanged)
        const botAdmin = await isBotAdmin(ctx);
        if (!botAdmin) {
            try {
                const r =
                    (typeof reasonText === "string")
                        ? reasonText
                        : (reasonText && typeof reasonText === "object" ? (reasonText.message || "") : "");

                const sent = await ctx.reply(`⚠️ ${r}\n\nBot is not an admin, so the punishment could not be applied.`, {
                    reply_to_message_id: msgId,
                });
                return sent;
            } catch (e) { }
            return;
        }

        const user_id = ctx.from.id;
        const nowSec = Math.floor(Date.now() / 1000);
        const untilSec = durationMs ? Math.floor((Date.now() + Number(durationMs)) / 1000) : 0;

        try {
            if (penalty === "kick") {
                await ctx.telegram.banChatMember(chatId, user_id, { until_date: nowSec + 35 });
                await ctx.telegram.unbanChatMember(chatId, user_id).catch(() => { });
                return;
            }

            if (penalty === "mute") {
                const permissions = {
                    can_send_messages: false,
                    can_send_audios: false,
                    can_send_documents: false,
                    can_send_photos: false,
                    can_send_videos: false,
                    can_send_video_notes: false,
                    can_send_voice_notes: false,
                    can_send_polls: false,
                    can_send_other_messages: false,
                    can_add_web_page_previews: false,
                    can_change_info: false,
                    can_invite_users: false,
                    can_pin_messages: false,
                    can_manage_topics: false,
                };

                const payload = untilSec ? { permissions, until_date: untilSec } : { permissions };
                await ctx.telegram.restrictChatMember(chatId, user_id, payload);
                return;
            }

            if (penalty === "ban") {
                const payload = untilSec ? { until_date: untilSec } : {};
                await ctx.telegram.banChatMember(chatId, user_id, payload);
                return;
            }
        } catch (e) { }
    };

    const pickForwardTarget = (msg) => {
        if (!msg) return null;

        const fc = msg.forward_from_chat;
        const fu = msg.forward_from;

        if (fc) {
            const type = normalizeLower(fc.type);
            const target = type === "channel" ? "channels" : "groups";
            const tokens = [];
            if (fc.username) tokens.push(String(fc.username));
            if (fc.id != null) tokens.push(String(fc.id));
            return { target, tokenList: tokens };
        }

        if (fu) {
            const target = fu.is_bot ? "bots" : "users";
            const tokens = [];
            if (fu.username) tokens.push(String(fu.username));
            if (fu.id != null) tokens.push(String(fu.id));
            return { target, tokenList: tokens };
        }

        if (msg.forward_sender_name) return { target: "users", tokenList: [] };
        return null;
    };

    const pickQuoteTarget = (msg) => {
        const ext = msg?.external_reply || msg?.reply_to_message?.external_reply;
        if (!ext) return null;

        const origin = ext.origin || null;
        const senderChat = origin?.sender_chat || origin?.chat || null;
        const senderUser = origin?.sender_user || origin?.user || null;

        if (senderChat) {
            const type = normalizeLower(senderChat.type);
            const target = type === "channel" ? "channels" : "groups";
            const tokens = [];
            if (senderChat.username) tokens.push(String(senderChat.username));
            if (senderChat.id != null) tokens.push(String(senderChat.id));
            return { target, tokenList: tokens };
        }

        if (senderUser) {
            const target = senderUser.is_bot ? "bots" : "users";
            const tokens = [];
            if (senderUser.username) tokens.push(String(senderUser.username));
            if (senderUser.id != null) tokens.push(String(senderUser.id));
            return { target, tokenList: tokens };
        }

        return { target: "users", tokenList: [] };
    };

    const buildForwardWhitelistTokenSet = (whitelist) => {
        const set = new Set();

        for (const raw of normalizeWhitelist(whitelist)) {
            const s = String(raw || "").trim();
            if (!s) continue;

            // If already numeric (user id) or chat id (-100...)
            if (/^-?\d+$/.test(s)) {
                set.add(normalizeLower(s));
                continue;
            }

            const norm = validateTelegramLinkOrUsername(s);
            if (!norm) {
                // keep raw as fallback (some people may store plain username without @)
                set.add(normalizeLower(s));
                continue;
            }

            const low = normalizeLower(norm);
            set.add(low);

            // @username => also allow "username"
            if (low.startsWith("@")) set.add(low.slice(1));

            // tg://user?id=123 => also allow "123"
            const tg = low.match(/^tg:\/\/user\?id=(\d+)$/i);
            if (tg) set.add(tg[1]);

            // https://t.me/username or /username/123 => also allow username + @username + base link
            const u = low.match(/^https:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/([a-z0-9_]{5,32})(?:\/.*)?$/i);
            if (u && u[1] !== "joinchat" && u[1] !== "c") {
                const uname = u[1].toLowerCase();
                set.add(uname);
                set.add("@" + uname);
                set.add(`https://t.me/${uname}`); // base
            }

            // https://t.me/c/123456789/... => also allow "-100123456789"
            const c = low.match(/^https:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/c\/(\d+)(?:\/.*)?$/i);
            if (c) set.add(`-100${c[1]}`);
        }

        return set;
    };

    const isAnyTokenWhitelisted = (tokenList, whitelist) => {
        const wlSet = buildForwardWhitelistTokenSet(whitelist);

        for (const t of tokenList || []) {
            const v = normalizeLower(t);
            if (!v) continue;

            if (wlSet.has(v)) return true;
            if (v.startsWith("@") && wlSet.has(v.slice(1))) return true;
            if (!v.startsWith("@") && wlSet.has("@" + v)) return true;

            // also try interpreting token itself as tg link/username
            const norm = validateTelegramLinkOrUsername(String(t));
            if (norm && wlSet.has(normalizeLower(norm))) return true;
        }

        return false;
    };

    bot.on("message", async (ctx, next) => {
        try {
            // IMPORTANT: anonymous admin / channel messages me ctx.from missing hota hai
            if (!ctx?.chat || !ctx?.message || !ctx?.from) return next();

            const chatType = normalizeLower(ctx.chat.type);
            if (!(chatType === "group" || chatType === "supergroup")) return next();

            const chatIdStr = String(ctx.chat.id);
            const offenderId = ctx.from.id;

            // Group owner + admins allowed for ANY message
            if (await isUserAdminOrCreator(ctx, offenderId)) return next();

            const ownerDoc = await getChatSettingsOwnerDoc(chatIdStr);
            if (!ownerDoc) return next();

            const ownerSettings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
            const anti_spam = ownerSettings?.anti_spam;
            if (!anti_spam) return next();

            // (A) Telegram links / usernames
            const tgRule = anti_spam.telegram_links;
            if (tgRule) {
                const penalty = normalizeLower(tgRule.penalty || "off");
                const delete_messages = !!tgRule.delete_messages;
                const usernameAnti = !!tgRule.username_antispam;

                const rawTargets = extractTelegramTargets(ctx.message, usernameAnti);

                const bad = [];
                for (const t of rawTargets) {
                    const norm = validateTelegramLinkOrUsername(t);
                    if (!norm) continue;

                    if (!tgTargetIsWhitelisted(norm, tgRule.whitelist)) bad.push(norm);
                }

                if (bad.length) {
                    const reason = usernameAnti
                        ? "Telegram links and usernames are not allowed in this group.\nPlease send a normal message instead."
                        : "Telegram links are not allowed in this group. Please remove the link and send message again.";

                    if (penalty === "warn") {
                        const warnDurationMs = Number(tgRule.penalty_duration || 0);

                        await handleWarnThenMaybePermanentMute({
                            ctx,
                            ownerDoc,
                            chatIdStr,
                            offenderId,
                            delete_messages,
                            reason,
                            warnDurationMs,
                            warnedUsersPath: "anti_spam.telegram_links.warned_users",
                            punishedUsersPath: "anti_spam.telegram_links.punished_users",
                        });

                        return;
                    }

                    const durationMs = Number(tgRule.penalty_duration || 0);
                    const sent = await applyPenalty(ctx, penalty, durationMs, delete_messages, reason);
                    if (sent?.message_id) {
                        await storeBotServiceMessage({
                            ownerDoc,
                            chatIdStr,
                            chatId: ctx.chat.id,
                            sentMessageId: sent.message_id,
                        });
                    }
                    if (penalty === "mute" || penalty === "ban") {
                        await addPunishedUser(
                            ownerDoc,
                            chatIdStr,
                            "anti_spam.telegram_links.punished_users",
                            offenderId,
                            penalty,
                            durationMs ? Date.now() + durationMs : Date.now() + 365 * 24 * 3600 * 1000
                        );
                    }
                    return;
                }

                // penalty off but delete on => delete only (if any non-whitelisted tg target)
                if (penalty === "off" && delete_messages && rawTargets.length) {
                    const anyNotAllowed = rawTargets.some((t) => {
                        const norm = validateTelegramLinkOrUsername(t);
                        if (!norm) return false;
                        return !tgTargetIsWhitelisted(norm, tgRule.whitelist);
                    });
                    if (anyNotAllowed) {
                        await safeDeleteMessage(ctx);
                        return;
                    }
                }
            }

            // (B) Forwarding
            const fwdInfo = pickForwardTarget(ctx.message);
            if (fwdInfo && anti_spam.forwarding) {
                const fwd = anti_spam.forwarding;
                const rule = fwd?.[fwdInfo.target];

                if (rule) {
                    const penalty = normalizeLower(rule.penalty || "off");
                    const delete_messages = !!rule.delete_messages;

                    const allowed = isAnyTokenWhitelisted(fwdInfo.tokenList, fwd.whitelist);
                    if (!allowed) {
                        const reason =
                            "Forwarded messages are not allowed in this group. Please send original messages instead.";

                        if (penalty === "warn") {
                            const warnDurationMs = Number(rule.penalty_duration || 0);
                            await handleWarnThenMaybePermanentMute({
                                ctx,
                                ownerDoc,
                                chatIdStr,
                                offenderId,
                                delete_messages,
                                reason,
                                warnDurationMs,
                                warnedUsersPath: `anti_spam.forwarding.${fwdInfo.target}.warned_users`,
                                punishedUsersPath: `anti_spam.forwarding.${fwdInfo.target}.punished_users`,
                            });

                            return;
                        }

                        const durationMs = Number(rule.penalty_duration || 0);
                        const sent = await applyPenalty(ctx, penalty, durationMs, delete_messages, reason);
                        if (sent?.message_id) {
                            await storeBotServiceMessage({
                                ownerDoc,
                                chatIdStr,
                                chatId: ctx.chat.id,
                                sentMessageId: sent.message_id,
                            });
                        }
                        if (penalty === "mute" || penalty === "ban") {
                            await addPunishedUser(
                                ownerDoc,
                                chatIdStr,
                                `anti_spam.forwarding.${fwdInfo.target}.punished_users`,
                                offenderId,
                                penalty,
                                durationMs ? Date.now() + durationMs : Date.now() + 365 * 24 * 3600 * 1000
                            );
                        }
                        return;
                    }
                }
            }

            // (C) Quote
            const quoteInfo = pickQuoteTarget(ctx.message);
            if (quoteInfo && anti_spam.quote) {
                const q = anti_spam.quote;
                const rule = q?.[quoteInfo.target];

                if (rule) {
                    const penalty = normalizeLower(rule.penalty || "off");
                    const delete_messages = !!rule.delete_messages;

                    const allowed = isAnyTokenWhitelisted(quoteInfo.tokenList, q.whitelist);
                    if (!allowed) {
                        const reason =
                            "Quoted messages from external chats are not allowed in this group. Please write an original message instead.";

                        if (penalty === "warn") {
                            const warnDurationMs = Number(rule.penalty_duration || 0);

                            await handleWarnThenMaybePermanentMute({
                                ctx,
                                ownerDoc,
                                chatIdStr,
                                offenderId,
                                delete_messages,
                                reason,
                                warnDurationMs,
                                warnedUsersPath: `anti_spam.quote.${quoteInfo.target}.warned_users`,
                                punishedUsersPath: `anti_spam.quote.${quoteInfo.target}.punished_users`,
                            });

                            return;
                        }

                        const durationMs = Number(rule.penalty_duration || 0);
                        const sent = await applyPenalty(ctx, penalty, durationMs, delete_messages, reason);
                        if (sent?.message_id) {
                            await storeBotServiceMessage({
                                ownerDoc,
                                chatIdStr,
                                chatId: ctx.chat.id,
                                sentMessageId: sent.message_id,
                            });
                        }
                        if (penalty === "mute" || penalty === "ban") {
                            await addPunishedUser(
                                ownerDoc,
                                chatIdStr,
                                `anti_spam.quote.${quoteInfo.target}.punished_users`,
                                offenderId,
                                penalty,
                                durationMs ? Date.now() + durationMs : Date.now() + 365 * 24 * 3600 * 1000
                            );
                        }
                        return;
                    }
                }
            }

            // (D) Total links block
            const lb = anti_spam.links_block;
            if (lb) {
                const penalty = normalizeLower(lb.penalty || "off");
                const delete_messages = !!lb.delete_messages;

                const links = extractAnyLinks(ctx.message);
                if (links.length) {
                    const notAllowed = links.filter((l) => !linkMatchesWhitelist(l, lb.whitelist));
                    if (notAllowed.length) {
                        const reason =
                            "Links are not allowed in this group. Please remove the link and send message again.";

                        if (penalty === "warn") {
                            const warnDurationMs = Number(lb.penalty_duration || 0);

                            await handleWarnThenMaybePermanentMute({
                                ctx,
                                ownerDoc,
                                chatIdStr,
                                offenderId,
                                delete_messages,
                                reason,
                                warnDurationMs,
                                warnedUsersPath: "anti_spam.links_block.warned_users",
                                punishedUsersPath: "anti_spam.links_block.punished_users",
                            });

                            return;
                        }

                        const durationMs = Number(lb.penalty_duration || 0);
                        const sent = await applyPenalty(ctx, penalty, durationMs, delete_messages, reason);
                        if (sent?.message_id) {
                            await storeBotServiceMessage({
                                ownerDoc,
                                chatIdStr,
                                chatId: ctx.chat.id,
                                sentMessageId: sent.message_id,
                            });
                        }
                        if (penalty === "mute" || penalty === "ban") {
                            await addPunishedUser(
                                ownerDoc,
                                chatIdStr,
                                "anti_spam.links_block.punished_users",
                                offenderId,
                                penalty,
                                durationMs ? Date.now() + durationMs : Date.now() + 365 * 24 * 3600 * 1000
                            );
                        }
                        return;
                    }
                }

                if (penalty === "off" && delete_messages && links.length) {
                    const anyNotAllowed = links.some((l) => !linkMatchesWhitelist(l, lb.whitelist));
                    if (anyNotAllowed) {
                        await safeDeleteMessage(ctx);
                        return;
                    }
                }
            }

            return next();
        } catch (e) {
            return next();
        }
    });
};