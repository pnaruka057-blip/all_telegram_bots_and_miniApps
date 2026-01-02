// anti_flood_Group.js
// Group antiflood enforcement (Redis sliding window, NO Map)
// Behavior: "N messages in T seconds" sliding window.
// Important: blocked attempts are NOT recorded (so window frees gradually as old msgs expire).

const user_setting_module = require("../models/user_settings_module");
const redis = require("../../../globle_helper/redisConfig");

module.exports = (bot) => {
    // -----------------------------
    // Basic helpers (same style as anti_spam_Group)
    // -----------------------------
    const normalizeLower = (v) => (v == null ? "" : String(v).trim().toLowerCase());

    const escapeHTML = (s) =>
        String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

    const mentionHTML = (u) => {
        const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || "User";
        return `<a href="tg://user?id=${Number(u?.id)}">${escapeHTML(name)}</a>`;
    };

    const PERM_UNTIL_MS = Date.now() + 100 * 365 * 24 * 3600 * 1000; // ~100 years
    const ensureArray = (v) => (Array.isArray(v) ? v : []);

    // -----------------------------
    // Redis compatibility helpers (node-redis v4 + ioredis/older)
    // -----------------------------
    const getRedisClient = () => {
        if (!redis) return null;
        if (typeof redis === "object") {
            // node-redis v4 style OR ioredis style
            if (
                typeof redis.get === "function" ||
                typeof redis.zadd === "function" ||
                typeof redis.zAdd === "function" ||
                typeof redis.zcard === "function" ||
                typeof redis.zCard === "function"
            ) {
                return redis;
            }
            if (redis.client) return redis.client;
        }
        return null;
    };

    const rExpire = async (key, ttlSec) => {
        try {
            const c = getRedisClient();
            if (!c || !ttlSec) return false;
            if (typeof c.expire === "function") {
                await c.expire(key, Number(ttlSec));
                return true;
            }
            return false;
        } catch {
            return false;
        }
    };

    const rZAdd = async (key, score, member) => {
        try {
            const c = getRedisClient();
            if (!c) return false;

            // node-redis v4
            if (typeof c.zAdd === "function") {
                await c.zAdd(key, [{ score: Number(score), value: String(member) }]);
                return true;
            }
            // ioredis / older
            if (typeof c.zadd === "function") {
                await c.zadd(key, Number(score), String(member));
                return true;
            }
            return false;
        } catch {
            return false;
        }
    };

    const rZRemRangeByScore = async (key, min, max) => {
        try {
            const c = getRedisClient();
            if (!c) return 0;

            // node-redis v4
            if (typeof c.zRemRangeByScore === "function") {
                const n = await c.zRemRangeByScore(key, Number(min), Number(max));
                return Number(n || 0);
            }
            // ioredis / older
            if (typeof c.zremrangebyscore === "function") {
                const n = await c.zremrangebyscore(key, Number(min), Number(max));
                return Number(n || 0);
            }
            return 0;
        } catch {
            return 0;
        }
    };

    const rZCard = async (key) => {
        try {
            const c = getRedisClient();
            if (!c) return 0;

            // node-redis v4
            if (typeof c.zCard === "function") {
                const n = await c.zCard(key);
                return Number(n || 0);
            }
            // ioredis / older
            if (typeof c.zcard === "function") {
                const n = await c.zcard(key);
                return Number(n || 0);
            }
            return 0;
        } catch {
            return 0;
        }
    };

    // Sliding window key
    const antifloodKey = (chatIdStr, userId) => `anti_flood:${chatIdStr}:${userId}`;

    // Returns true => FLOODED (block), false => ALLOWED (and recorded).
    // NOTE: Blocked attempts are NOT recorded (this is required for your 13s/15s example).
    const checkThenAddFloodRedis = async ({ chatIdStr, userId, msgLimit, timeFrameSec, messageId }) => {
        const c = getRedisClient();
        if (!c) return false;

        const limit = Number(msgLimit || 0);
        const tf = Number(timeFrameSec || 0);
        if (!limit || !tf || limit <= 0 || tf <= 0) return false;

        const now = Date.now();
        const cutoff = now - tf * 1000;
        const key = antifloodKey(chatIdStr, userId);

        // 1) remove expired
        await rZRemRangeByScore(key, 0, cutoff);

        // 2) count current window
        const count = await rZCard(key);

        // 3) if already at limit -> FLOODED, do not record this attempt
        if (count >= limit) {
            await rExpire(key, Math.ceil(tf) + 2);
            return true;
        }

        // 4) otherwise record and allow
        const member = `${now}:${messageId || 0}`;
        await rZAdd(key, now, member);
        await rExpire(key, Math.ceil(tf) + 2);

        return false;
    };

    // -----------------------------
    // Settings/doc helpers
    // -----------------------------
    const getChatSettingsOwnerDoc = async (chatIdStr) => {
        try {
            return await user_setting_module.findOne({ [`settings.${chatIdStr}`]: { $exists: true } });
        } catch {
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

    const isUserAdminOrCreator = async (ctx, userId) => {
        try {
            const m = await ctx.telegram.getChatMember(ctx.chat.id, userId);
            return m && (m.status === "administrator" || m.status === "creator");
        } catch {
            return false;
        }
    };

    const isBotAdmin = async (ctx) => {
        try {
            const me = await ctx.telegram.getMe();
            const m = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
            return m && (m.status === "administrator" || m.status === "creator");
        } catch {
            return false;
        }
    };

    const safeDeleteMessage = async (ctx) => {
        try {
            if (!ctx?.chat?.id || !ctx?.message?.message_id) return;
            await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
        } catch { }
    };

    // -----------------------------
    // Warn/punish tracking on DB (anti_flood.warned_users / anti_flood.punished_users)
    // -----------------------------
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
        for (let i = 0; i < parts.length - 1; i++) {
            ref[parts[i]] = ref[parts[i]] || {};
            ref = ref[parts[i]];
        }

        const lastKey = parts[parts.length - 1];
        const arr = ensureArray(ref[lastKey]);
        ref[lastKey] = arr.filter((x) => Number(x?.user_id) !== Number(offenderId));
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

        // remove old entry
        ref[lastKey] = ref[lastKey].filter((x) => Number(x?.user_id) !== Number(offenderId));
        ref[lastKey].push({
            user_id: Number(offenderId),
            type: t,
            until_ms: Number(untilMs),
        });

        await ownerDoc.save().catch(() => { });
    };

    // -----------------------------
    // Penalty applier
    // -----------------------------
    const applyPenalty = async (ctx, penalty, durationMs, delete_messages, reasonText) => {
        const chatId = ctx.chat?.id;
        const msgId = ctx.message?.message_id;
        const offender = ctx.from;

        if (delete_messages) await safeDeleteMessage(ctx);
        if (penalty === "off") return;

        // WARN does not require admin
        if (penalty === "warn") {
            try {
                const who = mentionHTML(offender);

                const payload = reasonText;
                const strikeText =
                    payload && typeof payload === "object" && payload.strikeText
                        ? String(payload.strikeText)
                        : "1/3";

                const strikeNo = Number(String(strikeText).split("/")[0] || 1);
                const message =
                    payload && typeof payload === "object"
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

                const extra = { parse_mode: "HTML", disable_web_page_preview: true };
                if (!delete_messages && chatId && msgId) extra.reply_to_message_id = msgId;

                await ctx.telegram.sendMessage(chatId, text, extra);
            } catch { }
            return;
        }

        // Other punishments need bot admin
        const botAdmin = await isBotAdmin(ctx);
        if (!botAdmin) {
            try {
                const r =
                    typeof reasonText === "string"
                        ? reasonText
                        : reasonText && typeof reasonText === "object"
                            ? (reasonText.message || "")
                            : "";
                await ctx.reply(`⚠️ ${r}\n\nBot is not an admin, so the punishment could not be applied.`, {
                    reply_to_message_id: msgId,
                });
            } catch { }
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
        } catch { }
    };

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

        // 1st / 2nd warn => warning only
        if (count <= 2) {
            await applyPenalty(ctx, "warn", 0, delete_messages, {
                message: `${reason}`,
                strikeText: `${count}/3`,
            });
            return true;
        }

        // 3rd warn => final warning + permanent mute (if bot admin)
        if (delete_messages) await safeDeleteMessage(ctx);

        const botAdmin = await isBotAdmin(ctx);
        await applyPenalty(ctx, "warn", 0, false, {
            message: botAdmin
                ? `${reason}\nAction: permanently muted.`
                : `${reason}\nAction: permanent mute would be applied, but the bot is not an admin.`,
            strikeText: `3/3`,
        });

        if (botAdmin) {
            // enforce permanent mute
            await applyPenalty(ctx, "mute", 0, false, reason);
            await addPunishedUser(ownerDoc, chatIdStr, punishedUsersPath, offenderId, "mute", PERM_UNTIL_MS);

            await resetWarnCount(ownerDoc, chatIdStr, warnedUsersPath, offenderId);
            return true;
        }

        return true;
    };

    // -----------------------------
    // Main enforcement: group messages
    // -----------------------------
    bot.on("message", async (ctx, next) => {
        try {
            // skip if missing essentials (anonymous admin / channel messages)
            if (!ctx?.chat || !ctx?.message || !ctx?.from) return next?.();

            const chatType = normalizeLower(ctx.chat.type);
            if (!(chatType === "group" || chatType === "supergroup")) return next?.();

            const chatIdStr = String(ctx.chat.id);
            const offenderId = ctx.from.id;

            // admins/creator bypass
            if (await isUserAdminOrCreator(ctx, offenderId)) return next?.();

            // Find owner doc which contains this chat settings
            const ownerDoc = await getChatSettingsOwnerDoc(chatIdStr);
            if (!ownerDoc) return next?.();

            const ownerSettings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
            const anti_flood = ownerSettings?.anti_flood; // IMPORTANT: matches owner UI module
            if (!anti_flood) return next?.();

            const msgLimit = typeof anti_flood.message_limit === "number" ? anti_flood.message_limit : 5;
            const time_frame = typeof anti_flood.time_frame === "number" ? anti_flood.time_frame : 3;

            const penalty = normalizeLower(anti_flood.penalty || "off"); // off|warn|kick|mute|ban
            const delete_messages = !!anti_flood.delete_messages;

            // If anti_flood is fully off (no delete, no penalty) => ignore
            if (penalty === "off" && !delete_messages) return next?.();
            // Decide flood (blocked attempts NOT recorded)
            const flooded = await checkThenAddFloodRedis({
                chatIdStr,
                userId: offenderId,
                msgLimit,
                timeFrameSec: time_frame,
                messageId: ctx.message?.message_id,
            });

            if (!flooded) return next?.();

            // Flood violation
            const reason =
                `Antiflood triggered: Too many messages.\n` +
                `Rule: max ${msgLimit} messages in ${time_frame} seconds.\n` +
                `Please slow down.`;

            // Duration (ms) for warn/mute/ban (kick ignores it)
            const durationMs = Number(anti_flood.penalty_duration || 0);

            // penalty off but delete on => delete only
            if (penalty === "off") {
                if (delete_messages) await safeDeleteMessage(ctx);
                return;
            }

            // warn flow (1/2 warn, 3rd => permanent mute)
            if (penalty === "warn") {
                const warnDurationMs = durationMs;
                await handleWarnThenMaybePermanentMute({
                    ctx,
                    ownerDoc,
                    chatIdStr,
                    offenderId,
                    delete_messages,
                    reason,
                    warnDurationMs,
                    warnedUsersPath: "anti_flood.warned_users",
                    punishedUsersPath: "anti_flood.punished_users",
                });
                return;
            }

            // kick/mute/ban
            await applyPenalty(ctx, penalty, durationMs, delete_messages, reason);

            // Track mute/ban in DB
            if (penalty === "mute" || penalty === "ban") {
                const untilMs = durationMs ? Date.now() + durationMs : PERM_UNTIL_MS;
                await addPunishedUser(ownerDoc, chatIdStr, "anti_flood.punished_users", offenderId, penalty, untilMs);
            }

            return;
        } catch (e) {
            return next?.();
        }
    });
};