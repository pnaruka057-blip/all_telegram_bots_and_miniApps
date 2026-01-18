// alphabets_Group.js
// Anti_spam_Group.js style enforcement for Alphabets
// - Detects dominant alphabet (arabic/cyrillic/chinese/latin)
// - Penalties: off | warn | kick | mute | ban
// - WARN: 1st/2nd => warning only, 3rd => final warning + permanent mute (if bot admin) [file:33]
// - Tracks warned_users / punished_users inside settings.<chatId>.alphabets.<langKey> [file:2]
// - Stores bot service messages for auto-delete using messages_module (type="bot_service_message") [file:1]

const user_setting_module = require("../models/user_settings_module");
const messages_module = require("../models/messages_module");

// ------------------------- Small helpers (same style as anti_spam_Group.js) -------------------------
const escapeHTML = (s) =>
    String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

const mentionHTML = (u) => {
    const name =
        [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || "User";
    return `<a href="tg://user?id=${Number(u?.id)}">${escapeHTML(name)}</a>`;
};

const normalizeLower = (v) => (v == null ? "" : String(v).trim().toLowerCase());

// Keep same keys as alphabets.js
const LANG_KEYS = ["arabic", "cyrillic", "chinese", "latin"];

// Unicode ranges (basic + extended where common)
const RX = {
    arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g,
    cyrillic: /[\u0400-\u04FF\u0500-\u052F\u2DE0-\u2DFF\uA640-\uA69F]/g,
    chinese: /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g,
    latin: /[A-Za-z\u00C0-\u00FF\u0100-\u024F]/g,
};

function countMatches(text, re) {
    const m = text.match(re);
    return m ? m.length : 0;
}

function detectDominantAlphabet(text) {
    if (!text) return null;

    const counts = {};
    for (const k of LANG_KEYS) counts[k] = countMatches(text, RX[k]);

    let best = null;
    let bestCount = 0;
    for (const k of LANG_KEYS) {
        if (counts[k] > bestCount) {
            best = k;
            bestCount = counts[k];
        }
    }

    return bestCount > 0 ? best : null;
}

function langLabel(langKey) {
    const map = { arabic: "arabic", cyrillic: "cyrillic", chinese: "chinese", latin: "latin" };
    return map[langKey] || langKey;
}

function ensureArray(v) {
    return Array.isArray(v) ? v : [];
}

// settings can be Map or plain object
function getChatSettingsFromDoc(doc, chatIdStr) {
    if (!doc) return null;
    const s =
        typeof doc.settings?.get === "function"
            ? doc.settings.get(chatIdStr)
            : doc.settings?.[chatIdStr];
    return s || null;
}

async function getChatSettingsOwnerDoc(chatIdStr) {
    try {
        // same style as anti_spam_Group.js: just find who has settings for this chat
        return await user_setting_module.findOne({ [`settings.${chatIdStr}`]: { $exists: true } });
    } catch {
        return null;
    }
}

async function isUserAdminOrCreator(ctx, userId) {
    try {
        const m = await ctx.telegram.getChatMember(ctx.chat.id, userId);
        return m && (m.status === "administrator" || m.status === "creator");
    } catch {
        // anti_spam_Group.js: if fails, treat as NOT admin so enforcement continues
        return false;
    }
}

async function isBotAdmin(ctx) {
    try {
        const me = await ctx.telegram.getMe();
        const m = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
        return m && (m.status === "administrator" || m.status === "creator");
    } catch {
        return false;
    }
}

async function safeDeleteMessage(ctx) {
    try {
        if (!ctx?.chat?.id || !ctx?.message?.message_id) return;
        await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch { }
}

// ------------------------- Auto delete store (same style as anti_spam_Group.js) -------------------------
async function storeBotServiceMessage({ ownerDoc, chatIdStr, chatId, sentMessageId }) {
    const DEFAULT_TTL_MS = 10 * 60 * 1000;

    try {
        if (!ownerDoc?._id || !sentMessageId) return;

        // NOTE: keeping same path style as anti_spam_Group.js (deletesettings/scheduled/botservice)
        // If your DB uses delete_settings/scheduled/bot_service, tell and it will be adjusted.
        const chatSettings = getChatSettingsFromDoc(ownerDoc, chatIdStr) || {};
        const delCfg = chatSettings?.deletesettings?.scheduled?.botservice;

        const enabled = typeof delCfg?.enabled === "boolean" ? delCfg.enabled : true;
        const ttlMs =
            typeof delCfg?.timems === "number" && delCfg.timems > 0 ? delCfg.timems : DEFAULT_TTL_MS;

        if (!enabled || ttlMs <= 0) return;

        const now = new Date();
        const deleteAt = new Date(now.getTime() + ttlMs);
        const ttlMinutes = Math.max(1, Math.round(ttlMs / 60000));

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

// ------------------------- warned_users / punished_users helpers (anti_spam_Group.js style) -------------------------
async function updateWarnCount(ownerDoc, chatIdStr, warnedUsersPath, offenderId, warnDurationMs) {
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
    const untilMs = now + Math.max(0, Number(warnDurationMs || 0)); // kept for parity with anti_spam_Group.js

    const idx = arr.findIndex((x) => Number(x?.user_id) === Number(offenderId));

    if (idx === -1) {
        arr.push({ user_id: Number(offenderId), count: 1, until_ms: untilMs });
        await ownerDoc.save().catch(() => { });
        return 1;
    }

    const nextCount = Math.min(3, Number(arr[idx]?.count || 0) + 1);
    arr[idx].count = nextCount;
    arr[idx].until_ms = untilMs;
    await ownerDoc.save().catch(() => { });
    return nextCount;
}

async function resetWarnCount(ownerDoc, chatIdStr, warnedUsersPath, offenderId) {
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
}

async function addPunishedUser(ownerDoc, chatIdStr, punishedUsersPath, offenderId, type, untilMs) {
    const settings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
    if (!settings) return;

    const t = normalizeLower(type);
    if (t !== "mute" && t !== "ban") return;

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
}

// ------------------------- applyPenalty (anti_spam_Group.js style) -------------------------
async function applyPenalty(ctx, penalty, durationMs, deleteMessages, reasonText) {
    const chatId = ctx.chat?.id;
    const msgId = ctx.message?.message_id;
    const offender = ctx.from;

    if (deleteMessages) await safeDeleteMessage(ctx);

    const p = normalizeLower(penalty || "off");
    if (p === "off") return null;

    // WARN message: always allowed even if bot not admin
    if (p === "warn") {
        try {
            const who = mentionHTML(offender);

            const payload = reasonText;
            const strikeText =
                payload && typeof payload === "object" && payload.strikeText
                    ? String(payload.strikeText)
                    : "1/3";

            const strikeNo = Number(String(strikeText).split("/")[0]) || 1;

            const message =
                payload && typeof payload === "object" && payload.message
                    ? String(payload.message)
                    : String(payload || "");

            const tail =
                strikeNo >= 3
                    ? `\nPlease avoid repeating this.\n<i>If this behavior continues, you will be permanently muted.</i>`
                    : `\nPlease avoid repeating this.`;

            const text =
                `⚠️ Warning (${escapeHTML(strikeText)})\n` +
                `Hii ${who},\n` +
                `${escapeHTML(message)}${tail}`;

            const extra = { parse_mode: "HTML", disable_web_page_preview: true };

            // reply only if original wasn't deleted
            if (!deleteMessages && chatId && msgId) extra.reply_to_message_id = msgId;

            const sent = await ctx.telegram.sendMessage(chatId, text, extra);
            return sent;
        } catch {
            return null;
        }
    }

    // For kick/mute/ban, bot must be admin
    const botAdmin = await isBotAdmin(ctx);
    if (!botAdmin) {
        try {
            const msg =
                typeof reasonText === "string"
                    ? reasonText
                    : reasonText && typeof reasonText === "object"
                        ? reasonText.message
                        : "Bot is not an admin, so the punishment could not be applied.";

            const sent = await ctx.reply(`${msg}\nBot is not an admin, so the punishment could not be applied.`, {
                reply_to_message_id: msgId,
            });
            return sent;
        } catch {
            return null;
        }
    }

    const userId = ctx.from.id;
    const nowSec = Math.floor(Date.now() / 1000);
    const untilSec = durationMs ? Math.floor((Date.now() + Number(durationMs)) / 1000) : 0;

    try {
        if (p === "kick") {
            await ctx.telegram.banChatMember(chatId, userId, { until_date: nowSec + 35 });
            await ctx.telegram.unbanChatMember(chatId, userId).catch(() => { });
            return null;
        }

        if (p === "mute") {
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
            await ctx.telegram.restrictChatMember(chatId, userId, payload);
            return null;
        }

        if (p === "ban") {
            const payload = untilSec ? { until_date: untilSec } : {};
            await ctx.telegram.banChatMember(chatId, userId, payload);
            return null;
        }
    } catch {
        return null;
    }

    return null;
}

// ------------------------- WARN flow: 1/2 warn, 3rd => permanent mute (anti_spam_Group.js style) -------------------------
const PERM_MUTE_UNTIL_MS = Date.now() + 100 * 365 * 24 * 3600 * 1000; // 100 years

async function handleWarnThenMaybePermanentMute(
    ctx,
    ownerDoc,
    chatIdStr,
    offenderId,
    deleteMessages,
    reason,
    warnDurationMs,
    warnedUsersPath,
    punishedUsersPath
) {
    const count = await updateWarnCount(ownerDoc, chatIdStr, warnedUsersPath, offenderId, warnDurationMs);

    // 1st/2nd warning
    if (count < 3) {
        const sent = await applyPenalty(ctx, "warn", 0, deleteMessages, {
            message: reason,
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

    // 3rd warning: final warning + permanent mute (if bot admin)
    if (deleteMessages) await safeDeleteMessage(ctx);

    const botAdmin = await isBotAdmin(ctx);

    let sent = await applyPenalty(ctx, "warn", 0, false, {
        message: botAdmin
            ? `${reason}\nYou are permanently muted.`
            : `${reason}\nPermanent mute would be applied, but the bot is not an admin.`,
        strikeText: "3/3",
    });

    if (botAdmin) {
        await applyPenalty(ctx, "mute", 0, false, reason);
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
}

// ------------------------- Main listener -------------------------
module.exports = (bot) => {
    bot.on("message", async (ctx, next) => {
        try {
            // Important: anonymous admin/channel messages may miss ctx.from
            if (!ctx?.chat || !ctx?.message || !ctx?.from) return next();

            const chatType = normalizeLower(ctx.chat.type);
            if (chatType !== "group" && chatType !== "supergroup") return next();

            const chatIdStr = String(ctx.chat.id);
            const offenderId = ctx.from.id;

            // admins/creator allowed
            if (await isUserAdminOrCreator(ctx, offenderId)) return next();

            // load owner doc for this chat (mongoose doc, not lean)
            const ownerDoc = await getChatSettingsOwnerDoc(chatIdStr);
            if (!ownerDoc) return next();

            const ownerSettings = getChatSettingsFromDoc(ownerDoc, chatIdStr);
            if (!ownerSettings) return next();

            const alph = ownerSettings.alphabets;
            if (!alph) return next();

            // read text/caption
            const text = String(ctx.message.text || ctx.message.caption || "").trim();
            if (!text) return next();

            const langKey = detectDominantAlphabet(text);
            if (!langKey) return next();

            const rule = alph?.[langKey] || {};
            const penalty = normalizeLower(rule.penalty || "off");
            const deleteMessages = Boolean(rule.delete_messages);

            // if OFF but delete enabled => only delete
            if (penalty === "off") {
                if (deleteMessages) await safeDeleteMessage(ctx);
                return next();
            }

            const reason = `Please avoid using ${langLabel(langKey)} alphabet here.`;

            // duration for mute/ban (warnDurationMs uses same field in anti_spam_Group.js)
            const durationMs = Number(rule.penalty_duration || 0);

            // paths relative to settings.<chatId>
            const warnedUsersPath = `alphabets.${langKey}.warned_users`;
            const punishedUsersPath = `alphabets.${langKey}.punished_users`;

            if (penalty === "warn") {
                await handleWarnThenMaybePermanentMute(
                    ctx,
                    ownerDoc,
                    chatIdStr,
                    offenderId,
                    deleteMessages,
                    reason,
                    durationMs,
                    warnedUsersPath,
                    punishedUsersPath
                );
                return;
            }

            // kick/mute/ban direct
            const sent = await applyPenalty(ctx, penalty, durationMs, deleteMessages, reason);

            if (sent?.message_id) {
                await storeBotServiceMessage({
                    ownerDoc,
                    chatIdStr,
                    chatId: ctx.chat.id,
                    sentMessageId: sent.message_id,
                });
            }

            // track punished users for mute/ban
            if (penalty === "mute" || penalty === "ban") {
                const untilMs =
                    durationMs > 0
                        ? Date.now() + durationMs
                        : Date.now() + 365 * 24 * 3600 * 1000; // fallback 1 year if no duration
                await addPunishedUser(ownerDoc, chatIdStr, punishedUsersPath, offenderId, penalty, untilMs);
            }

            return;
        } catch (err) {
            console.error("alphabets_Group listener error:", err);
            return next();
        }
    });
};