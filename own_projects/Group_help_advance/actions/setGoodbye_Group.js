// setGoodbye_Group.js
// Reliable goodbye sender + force-bot-start enforcement
// Matches your good_bye.js fields: deletelast, mediatype, ispmallowed, isforcebotstart

const { Markup } = require("telegraf");
const user_setting_module = require("../models/user_settings_module");
const messages_module = require("../models/messages_module");
const redis = require("../../../globle_helper/redisConfig");

// ------------------------- Redis helpers -------------------------
async function rGet(key) {
    try {
        if (!redis) return null;
        if (typeof redis.get === "function") return await redis.get(key);
        if (redis?.client && typeof redis.client.get === "function") return await redis.client.get(key);
        return null;
    } catch {
        return null;
    }
}

async function rSet(key, value, ttlSec = null) {
    try {
        if (!redis) return false;

        // node-redis v4
        if (typeof redis.set === "function") {
            if (ttlSec) {
                try { await redis.set(key, value, { EX: ttlSec }); return true; } catch { }
                try { await redis.set(key, value, "EX", ttlSec); return true; } catch { }
            }
            await redis.set(key, value);
            if (ttlSec && typeof redis.expire === "function") {
                try { await redis.expire(key, ttlSec); } catch { }
            }
            return true;
        }

        // redis.client fallback
        if (redis?.client && typeof redis.client.set === "function") {
            await redis.client.set(key, value);
            if (ttlSec && typeof redis.client.expire === "function") {
                try { await redis.client.expire(key, ttlSec); } catch { }
            }
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

function keyLastGoodbye(chatId) {
    return `goodbye:last:${chatId}`;
}

function keyForceStartWarn(chatId, userId) {
    return `forceStart:warn:${chatId}:${userId}`;
}

function keyCanDm(userId) {
    return `forceStart:canDM:${userId}`;
}

// ------------------------- Helpers -------------------------
function normalizeTgLink(raw) {
    if (!raw) return null;
    let link = String(raw).trim();
    if (link.startsWith("@")) link = `https://t.me/${link.slice(1)}`;
    if (/^t\.me\//i.test(link)) link = `https://${link}`;
    if (!/^https?:\/\//i.test(link) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(link)) link = `https://${link}`;
    return link;
}

function escapeHTML(input) {
    return String(input ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function userMentionHTML(user) {
    const id = user?.id;
    const name = escapeHTML(
        [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || user?.username || "User"
    );
    if (!id) return name;
    return `<a href="tg://user?id=${id}">${name}</a>`;
}

function applyPlaceholders(text, ctx, member, actor) {
    if (!text) return text;

    const chat = ctx.chat || {};
    const m = member || {};
    const a = actor || null;

    const fullName = [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.username || "User";
    const actorFullName = a ? ([a.first_name, a.last_name].filter(Boolean).join(" ").trim() || a.username || "User") : "";

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

        // optional (same keys as welcome file)
        "{inviter_id}": a ? String(a.id ?? "") : "",
        "{inviter_name}": a ? (a.first_name ?? "") : "",
        "{inviter_surname}": a ? (a.last_name ?? "") : "",
        "{inviter_first_name}": a ? (a.first_name ?? "") : "",
        "{inviter_last_name}": a ? (a.last_name ?? "") : "",
        "{inviter_username}": a?.username ? `@${a.username}` : "",
        "{inviter_full_name}": a ? actorFullName : "",
        "{inviter_mention}": a ? userMentionHTML(a) : "",
    };

    let out = String(text);

    for (const [k, v] of Object.entries(map)) {
        const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        out = out.replace(re, String(v));
    }

    // backward compat (%first_name% etc)
    out = out
        .replace(/%first_name%/gi, String(map["{first_name}"]))
        .replace(/%last_name%/gi, String(map["{last_name}"]))
        .replace(/%username%/gi, String(map["{username}"]))
        .replace(/%full_name%/gi, String(map["{full_name}"]))
        .replace(/%mention%/gi, String(map["{mention}"]))
        .replace(/%chat_title%/gi, String(map["{chat_title}"]));

    return out;
}

function buildInlineKeyboard(buttonRows, ctx, member, actor) {
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

            content = applyPlaceholders(content, ctx, member, actor);

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

            const encoded = Buffer.from(content, "utf8").toString("base64");
            const safeText = String(text).replace(/_/g, "-").slice(0, 18);
            rowButtons.push(Markup.button.callback(text, `GENERIC_${safeText}_${encoded}`));
        }

        if (rowButtons.length) inlineKeyboard.push(rowButtons);
    }

    return inlineKeyboard.length ? inlineKeyboard : undefined;
}

async function isChatAdmin(ctx, chatId, userId) {
    try {
        const m = await ctx.telegram.getChatMember(chatId, userId);
        const st = m?.status;
        return st === "creator" || st === "administrator";
    } catch {
        // if cannot check, don't block
        return true;
    }
}

// Key fix: "started" check via DM ability (no visible message)
async function canBotMessageUser(ctx, userId) {
    const cacheKey = keyCanDm(userId);
    const cached = await rGet(cacheKey);
    if (cached === "1") return true;
    if (cached === "0") return false;

    let ok = false;
    try {
        await ctx.telegram.sendChatAction(userId, "typing"); // silent check
        ok = true;
    } catch {
        ok = false;
    }

    // Cache: if ok, keep long; if not, keep short (so user can start and pass quickly)
    await rSet(cacheKey, ok ? "1" : "0", ok ? 24 * 60 * 60 : 30);
    return ok;
}

async function scheduleAutoDeleteIfEnabled(chatId, sentMessageId, ownerDoc, chatIdStr) {
    try {
        if (!sentMessageId || !ownerDoc?._id) return;

        const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
        const del = chatSettings?.deletesettings || {};
        const scheduled = del?.scheduled || {};
        const cfg = scheduled?.goodbye || null;

        const DEFAULT_TTL_MS = 10 * 60 * 1000;
        const enabled = (typeof cfg?.enabled === "boolean") ? cfg.enabled : true;
        const ttlMs = (typeof cfg?.timems === "number" && cfg.timems > 0) ? cfg.timems : DEFAULT_TTL_MS;

        if (!enabled) return;

        const now = new Date();
        const deleteAt = new Date(now.getTime() + ttlMs);
        const ttlMinutes = Math.max(1, Math.round(ttlMs / 60000));

        await messages_module.updateOne(
            { groupid: Number(chatId), messageid: Number(sentMessageId) },
            {
                $setOnInsert: { userDBid: ownerDoc._id },
                $set: {
                    sentat: now,
                    deleteat: deleteAt,
                    ttlminutes: ttlMinutes,
                    type: "goodbye",
                    status: "pending",
                },
            },
            { upsert: true }
        );
    } catch (e) {
        console.error("Error scheduling auto-delete (goodbye):", e);
    }
}

async function sendGoodbye(ctx, leftMember, actor = null) {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const chatId = chat.id;
    const chatIdStr = String(chatId);

    // Find owner doc where goodbye enabled for this chat
    const ownerDoc = await user_setting_module.findOne({
        [`settings.${chatIdStr}.goodbye.enabled`]: true,
    }).lean();

    if (!ownerDoc) return;

    const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
    const goodbye = chatSettings?.goodbye || {};
    if (!goodbye?.enabled) return;

    // IMPORTANT: match your good_bye.js naming
    const pmAllowed = !!goodbye.ispmallowed;
    const deleteLast = (!pmAllowed) && !!goodbye.deletelast;

    const text = applyPlaceholders(goodbye.text || "", ctx, leftMember, actor);
    const inlineKeyboard = buildInlineKeyboard(goodbye.buttons || [], ctx, leftMember, actor);

    const media = goodbye.media;
    const mediaType = String(goodbye.mediatype || "").toLowerCase();

    const hasMedia = !!media && !!mediaType;
    const hasText = !!String(text || "").trim();
    const hasButtons = !!(inlineKeyboard && inlineKeyboard.length);

    if (!hasMedia && !hasText && !hasButtons) return;

    // ---- Private only ----
    if (pmAllowed) {
        try {
            if (hasMedia) {
                const opts = {
                    caption: hasText ? text : undefined,
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: inlineKeyboard ? Markup.inlineKeyboard(inlineKeyboard).reply_markup : undefined,
                };
                if (mediaType === "photo") await ctx.telegram.sendPhoto(leftMember.id, media, opts);
                else if (mediaType === "video") await ctx.telegram.sendVideo(leftMember.id, media, opts);
                else await ctx.telegram.sendDocument(leftMember.id, media, opts);
            } else {
                await ctx.telegram.sendMessage(leftMember.id, hasText ? text : "", {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    reply_markup: inlineKeyboard ? Markup.inlineKeyboard(inlineKeyboard).reply_markup : undefined,
                });
            }
        } catch {
            // can't DM -> silently skip (as requested)
        }
        return;
    }

    // ---- Group send ----
    if (deleteLast) {
        const lastMsgIdStr = await rGet(keyLastGoodbye(chatId));
        const lastMsgId = lastMsgIdStr ? Number(lastMsgIdStr) : null;
        if (lastMsgId) {
            try { await ctx.telegram.deleteMessage(chatId, lastMsgId); } catch { }
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
        await rSet(keyLastGoodbye(chatId), String(sentId));
        await scheduleAutoDeleteIfEnabled(chatId, sentId, ownerDoc, chatIdStr);
    }
}

// ------------------------- Main module -------------------------
module.exports = (bot) => {
    console.log("ksd fkjsf skf skdf skf sjkdfsd");
    // A) Force bot start enforcement
    bot.on("message", async (ctx) => {
        try {
            const chat = ctx.chat;
            if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

            const msg = ctx.message;
            const from = msg?.from;
            if (!from || from.is_bot) return;

            // Ignore service messages
            if (msg?.new_chat_members || msg?.left_chat_member) return;

            const chatId = chat.id;
            const chatIdStr = String(chatId);
            const userId = from.id;

            // Find owner doc where force bot start is ON
            const ownerDoc = await user_setting_module.findOne({
                [`settings.${chatIdStr}.goodbye.isforcebotstart`]: true,
            }).lean();

            if (!ownerDoc) return;

            // Skip admins
            const admin = await isChatAdmin(ctx, chatId, userId);
            if (admin) return;

            // Key fix: check "started" via DM-ability
            const started = await canBotMessageUser(ctx, userId);
            if (started) return;

            // Delete message
            try { await ctx.telegram.deleteMessage(chatId, msg.message_id); } catch { }

            // Throttle warning
            const warnKey = keyForceStartWarn(chatId, userId);
            const already = await rGet(warnKey);
            if (already) return;
            await rSet(warnKey, "1", 15);

            const botUser = process.env.BOT_USERNAME_GROUP_HELP_ADVANCE || bot?.botInfo?.username || "this_bot";
            const startLink = `https://t.me/${botUser}?start=force_start`;

            const warnText =
                `${userMentionHTML(from)}, you must start the bot in private chat before you can send messages here.\n\n` +
                `Start now: <a href="${startLink}">@${botUser}</a>`;

            await ctx.telegram.sendMessage(chatId, warnText, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });
        } catch (err) {
            console.error("Force bot start listener error:", err);
        }
    });

    // B1) Goodbye via left_chat_member (works in many groups)
    bot.on("left_chat_member", async (ctx) => {
        try {
            const left = ctx.message?.left_chat_member;
            if (!left?.id) return;
            // skip bot itself leaving
            if (left?.is_bot && bot?.botInfo?.username && left.username === bot.botInfo.username) return;

            const actor = (ctx.message?.from && ctx.message.from?.id !== left.id) ? ctx.message.from : null;
            await sendGoodbye(ctx, left, actor);
        } catch (err) {
            console.error("left_chat_member goodbye error:", err);
        }
    });

    // B2) Fallback: Goodbye via chat_member updates (more reliable for supergroups)
    bot.on("chat_member", async (ctx) => {
        try {
            const upd = ctx.update?.chat_member;
            if (!upd) return;

            const chat = upd.chat;
            if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

            const oldStatus = upd.old_chat_member?.status;
            const newStatus = upd.new_chat_member?.status;
            const user = upd.new_chat_member?.user;

            if (!user?.id) return;

            const leftNow = (newStatus === "left" || newStatus === "kicked");
            const wasInChat = ["member", "restricted", "administrator"].includes(oldStatus);

            if (!leftNow || !wasInChat) return;

            // actor in chat_member updates is "from"
            const actor = upd.from || null;

            // skip bot itself
            if (user?.is_bot && bot?.botInfo?.username && user.username === bot.botInfo.username) return;

            // Create a minimal ctx-like wrapper for sendGoodbye that expects ctx.chat/ctx.reply
            // Here ctx.chat already exists for this update in telegraf, so sendGoodbye(ctx, ...) works.
            await sendGoodbye(ctx, user, actor);
        } catch (err) {
            console.error("chat_member goodbye error:", err);
        }
    });
};
