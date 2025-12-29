// setWelcome_Group.js
// Sends welcome message in groups when new members join.
// Features:
// - Supports first-join mode using Redis
// - Optional delete-last welcome message using Redis
// - Supports text + media + inline buttons
// - Matches callback prefixes used by ./buttons.js (POPUP_, ALERT_, DEL_, PERSONAL_)

const { Markup } = require("telegraf");
const user_setting_module = require("../models/user_settings_module");
const messages_module = require("../models/messages_module");

// NOTE: keep this import path as in your project
const redis = require("../../../globle_helper/redisConfig");

// ------------------------- Redis helpers -------------------------
async function rGet(key) {
    try {
        if (!redis) return null;
        if (typeof redis.get === "function") return await redis.get(key);
        if (redis?.client && typeof redis.client.get === "function") return await redis.client.get(key);
        return null;
    } catch (_) {
        return null;
    }
}

async function rSet(key, value, ttlSec = null) {
    try {
        if (!redis) return false;

        // node-redis v4
        if (ttlSec && typeof redis.set === "function") {
            try {
                await redis.set(key, value, { EX: ttlSec });
                return true;
            } catch (_) { }
        }

        // ioredis / older
        if (ttlSec && typeof redis.set === "function") {
            try {
                await redis.set(key, value, "EX", ttlSec);
                return true;
            } catch (_) { }
        }

        // no ttl
        if (typeof redis.set === "function") {
            await redis.set(key, value);
            if (ttlSec && typeof redis.expire === "function") {
                try { await redis.expire(key, ttlSec); } catch (_) { }
            }
            return true;
        }

        // redis.client fallback
        if (redis?.client && typeof redis.client.set === "function") {
            await redis.client.set(key, value);
            if (ttlSec && typeof redis.client.expire === "function") {
                try { await redis.client.expire(key, ttlSec); } catch (_) { }
            }
            return true;
        }

        return false;
    } catch (_) {
        return false;
    }
}

async function rDel(key) {
    try {
        if (!redis) return false;
        if (typeof redis.del === "function") {
            await redis.del(key);
            return true;
        }
        if (redis?.client && typeof redis.client.del === "function") {
            await redis.client.del(key);
            return true;
        }
        return false;
    } catch (_) {
        return false;
    }
}

function keyLastWelcome(chatId) {
    return `welcome:last:${chatId}`;
}

function keyFirstJoin(chatId, userId) {
    return `welcome:first:${chatId}:${userId}`;
}

// Set to null to keep forever; or set e.g. 2 years to avoid unlimited growth
const FIRST_JOIN_TTL_SEC = null;

// ------------------------- Safe HTML helpers -------------------------
function escapeHTML(input) {
    return String(input ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function userMentionHTML(user) {
    const id = user?.id;
    const name = escapeHTML([user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || user?.username || "User");
    if (!id) return name;
    return `<a href="tg://user?id=${id}">${name}</a>`;
}

function normalizeTgLink(raw) {
    if (!raw) return null;
    let link = String(raw).trim();

    if (link.startsWith("@")) link = `https://t.me/${link.slice(1)}`;
    if (/^t\.me\//i.test(link)) link = `https://${link}`;
    if (!/^https?:\/\//i.test(link) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(link)) link = `https://${link}`;

    return link;
}

function applyPlaceholders(text, ctx, member, inviter) {
    if (!text) return text;

    const chat = ctx.chat || {};
    const m = member || {};
    const inv = inviter || null;

    const fullName = [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.username || "User";
    const invFullName = inv ? ([inv.first_name, inv.last_name].filter(Boolean).join(" ").trim() || inv.username || "User") : "";

    const map = {
        "{id}": String(m.id ?? ""),
        "{name}": m.first_name ?? "",
        "{surname}": m.last_name ?? "",
        "{first_name}": m.first_name ?? "",
        "{last_name}": m.last_name ?? "",
        "{username}": m.username ? `@${m.username}` : "",
        "{full_name}": fullName,
        "{mention}": userMentionHTML(m),

        "{groupname}": chat.title ?? "",
        "{group_name}": chat.title ?? "",
        "{chat_title}": chat.title ?? "",
        "{chat_id}": String(chat.id ?? ""),

        "{inviter_id}": inv ? String(inv.id ?? "") : "",
        "{inviter_name}": inv ? (inv.first_name ?? "") : "",
        "{inviter_surname}": inv ? (inv.last_name ?? "") : "",
        "{inviter_first_name}": inv ? (inv.first_name ?? "") : "",
        "{inviter_last_name}": inv ? (inv.last_name ?? "") : "",
        "{inviter_username}": inv?.username ? `@${inv.username}` : "",
        "{inviter_full_name}": inv ? invFullName : "",
        "{inviter_mention}": inv ? userMentionHTML(inv) : "",
    };

    let out = String(text);

    // Replace {...} placeholders case-insensitively
    for (const [k, v] of Object.entries(map)) {
        const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        out = out.replace(re, String(v));
    }

    // Backward compat for %first_name% style
    out = out
        .replace(/%first_name%/gi, String(map["{first_name}"]))
        .replace(/%last_name%/gi, String(map["{last_name}"]))
        .replace(/%username%/gi, String(map["{username}"]))
        .replace(/%full_name%/gi, String(map["{full_name}"]))
        .replace(/%mention%/gi, String(map["{mention}"]))
        .replace(/%chat_title%/gi, String(map["{chat_title}"]));

    return out;
}

function buildInlineKeyboard(buttonRows, ctx, member, inviter) {
    if (!Array.isArray(buttonRows) || buttonRows.length === 0) return undefined;

    const inlineKeyboard = [];

    for (const row of buttonRows) {
        if (!Array.isArray(row) || row.length === 0) continue;
        const rowButtons = [];

        for (const btn of row) {
            if (!btn?.text || !btn?.content) continue;

            const text = String(btn.text).trim();
            let content = String(btn.content).trim();
            if (!text || !content) continue;

            content = applyPlaceholders(content, ctx, member, inviter);

            // URL buttons
            const maybeUrl = normalizeTgLink(content);
            if (maybeUrl && /^https?:\/\//i.test(maybeUrl)) {
                rowButtons.push(Markup.button.url(text, maybeUrl));
                continue;
            }

            const low = content.toLowerCase();

            if (low.startsWith("popup:")) {
                const encoded = Buffer.from(content, "utf8").toString("base64");
                rowButtons.push(Markup.button.callback(text, `POPUP_${encoded}`));
                continue;
            }

            if (low.startsWith("alert:")) {
                const encoded = Buffer.from(content, "utf8").toString("base64");
                rowButtons.push(Markup.button.callback(text, `ALERT_${encoded}`));
                continue;
            }

            if (low.startsWith("share:")) {
                const shareText = content.replace(/^share:/i, "").trim();
                rowButtons.push(Markup.button.switchToChat(text, shareText));
                continue;
            }

            if (low.startsWith("copy:")) {
                const copyText = content.replace(/^copy:/i, "").trim();
                rowButtons.push({ text, copy_text: { text: copyText } });
                continue;
            }

            if (low === "del:") {
                const encoded = Buffer.from(content, "utf8").toString("base64");
                rowButtons.push(Markup.button.callback(text, `DEL_${encoded}`));
                continue;
            }

            if (low.startsWith("personal:")) {
                const cmd = content.replace(/^personal:/i, "").trim();
                const encoded = Buffer.from(cmd, "utf8").toString("base64");
                rowButtons.push(Markup.button.callback(text, `PERSONAL_${encoded}`));
                continue;
            }

            // Fallback generic callback (buttons.js currently just shows a toast)
            const encoded = Buffer.from(content, "utf8").toString("base64");
            const safeText = String(text).replace(/_/g, "-").slice(0, 18);
            rowButtons.push(Markup.button.callback(text, `GENERIC_${safeText}_${encoded}`));
        }

        if (rowButtons.length) inlineKeyboard.push(rowButtons);
    }

    return inlineKeyboard.length ? inlineKeyboard : undefined;
}

async function scheduleAutoDeleteIfEnabled(bot, chatId, sentMessageId, ownerDoc, chatIdStr) {
    try {
        // Default: 10 minutes (agar db me setting missing ho)
        const DEFAULT_TTL_MS = 10 * 60 * 1000;

        // Welcome ke delete-settings (tumhare code me ye path already use ho raha hai)
        const delCfg = ownerDoc?.settings?.[chatIdStr]?.delete_settings?.scheduled?.welcome;

        // enabled missing ho to default ON (same logic as regulation case)
        const enabled = (typeof delCfg?.enabled === "boolean") ? delCfg.enabled : true;

        // time missing ho to 10 min
        const ttlMs =
            (typeof delCfg?.time_ms === "number" && delCfg.time_ms > 0)
                ? delCfg.time_ms : DEFAULT_TTL_MS;

        if (!enabled || !sentMessageId) return;

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
                    type: "welcome",
                    status: "pending",
                },
            },
            { upsert: true }
        );
    } catch (e) {
        console.error("Error scheduling auto-delete (welcome):", e);
    }
}

// ------------------------- Main listener -------------------------
module.exports = (bot) => {
    bot.on("new_chat_members", async (ctx) => {
        try {
            const chat = ctx.chat;
            if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

            const chatId = chat.id;
            const chatIdStr = String(chatId);

            const newMembers = ctx.message?.new_chat_members || [];
            if (!Array.isArray(newMembers) || newMembers.length === 0) return;

            // Find the owner doc that has welcome enabled for this chat
            const ownerDoc = await user_setting_module.findOne({ [`settings.${chatIdStr}.welcome.enabled`]: true }).lean();
            if (!ownerDoc) return;

            // settings can be Map or object, handle both
            const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
            const welcome = chatSettings.welcome || {};
            if (!welcome?.enabled) return;

            const modeRaw = String(welcome.mode || "always").toLowerCase(); // always | first_join | firstjoin | first
            const deleteLast = !!(welcome.delete_last ?? welcome.deletelast ?? welcome.deleteLast);

            const fromUser = ctx.message?.from || null; // inviter candidate

            for (const member of newMembers) {
                // Skip if bot itself joined
                if (member?.is_bot && member?.username && bot.botInfo?.username && member.username === bot.botInfo.username) continue;

                // first-join mode
                if (modeRaw === "first_join" || modeRaw === "firstjoin" || modeRaw === "first") {
                    const fk = keyFirstJoin(chatId, member.id);
                    const already = await rGet(fk);
                    if (already) continue;
                    await rSet(fk, "1", FIRST_JOIN_TTL_SEC);
                }

                const inviter = (fromUser && fromUser.id && member?.id && fromUser.id !== member.id) ? fromUser : null;

                const text = applyPlaceholders(welcome.text || "", ctx, member, inviter);
                const inlineKeyboard = buildInlineKeyboard(welcome.buttons || [], ctx, member, inviter);

                const media = welcome.media;
                const mediaType = (welcome.media_type || welcome.mediatype || welcome.mediaType || "").toLowerCase();

                const hasMedia = !!media && !!mediaType;
                const hasText = !!String(text || "").trim();
                const hasButtons = !!(inlineKeyboard && inlineKeyboard.length);
                if (!hasMedia && !hasText && !hasButtons) continue;

                // delete previous welcome if enabled
                if (deleteLast) {
                    const lastMsgIdStr = await rGet(keyLastWelcome(chatId));
                    const lastMsgId = lastMsgIdStr ? Number(lastMsgIdStr) : null;
                    if (lastMsgId) {
                        try { await ctx.telegram.deleteMessage(chatId, lastMsgId); } catch (_) { }
                    }
                }

                let sent;

                if (hasMedia) {
                    const opts = {
                        caption: hasText ? text : undefined,
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                        reply_markup: inlineKeyboard ? Markup.inlineKeyboard(inlineKeyboard).reply_markup : undefined,
                    };

                    if (mediaType === "photo") sent = await ctx.replyWithPhoto(media, opts);
                    else if (mediaType === "video") sent = await ctx.replyWithVideo(media, opts);
                    else sent = await ctx.replyWithDocument(media, opts);
                } else {
                    sent = await ctx.reply(hasText ? text : "", {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                        reply_markup: inlineKeyboard ? Markup.inlineKeyboard(inlineKeyboard).reply_markup : undefined,
                    });
                }

                const sentId = sent?.message_id || sent?.messageId;
                if (sentId) {
                    await rSet(keyLastWelcome(chatId), String(sentId));
                    await scheduleAutoDeleteIfEnabled(bot, chatId, sentId, ownerDoc, chatIdStr);
                }
            }
        } catch (err) {
            console.error("setWelcome_Group listener error:", err);
        }
    });
};