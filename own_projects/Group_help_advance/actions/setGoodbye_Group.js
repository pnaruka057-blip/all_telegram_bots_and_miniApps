const { Markup } = require("telegraf");

const user_setting_module = require("../models/user_settings_module");
const messages_module = require("../models/messages_module");
const { ALLOWED_PLACEHOLDERS } = require("../helpers/const"); 

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
        .replace(/'/g, "'");
}

function userMentionHTML(user) {
    const id = user?.id;
    const name = escapeHTML(
        [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || user?.username || "User"
    );
    if (!id) return name;
    return `<a href="tg://user?id=${id}">${name}</a>`;
}

/**
 * Replace ONLY allowed placeholders (case-insensitive in text),
 * but output placeholders are defined as uppercase keys as per ALLOWED_PLACEHOLDERS.
 */
function applyPlaceholders(text, ctx, member) {
    if (!text) return text;

    const chat = ctx.chat || {};
    const m = member || {};

    const map = {
        "{ID}": String(m.id ?? ""),
        "{MENTION}": userMentionHTML(m),
        "{NAME}": m.first_name ?? "",
        "{SURNAME}": m.last_name ?? "",
        "{USERNAME}": m.username ? `@${m.username}` : "",
        "{GROUPNAME}": chat.title ?? "",
    };

    let out = String(text);

    // Replace only placeholders present in ALLOWED_PLACEHOLDERS
    for (const key of ALLOWED_PLACEHOLDERS || []) {
        const val = map[key] ?? "";
        const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"); // case-insensitive match
        out = out.replace(re, String(val));
    }

    return out;
}

function buildInlineKeyboard(buttonRows, ctx, member) {
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

            // Apply allowed placeholders inside button content as well
            content = applyPlaceholders(content, ctx, member);

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
        return true;
    }
}

// Snake_case only (your schema)
function getGoodbyeSettings(chatSettings) {
    const goodbye = chatSettings?.goodbye || {};
    return {
        enabled: !!goodbye.enabled,
        is_pm_allowed: !!goodbye.is_pm_allowed,
        is_force_bot_start: !!goodbye.is_force_bot_start,
        delete_last: !!goodbye.delete_last,
        text: String(goodbye.text ?? ""),
        media: goodbye.media,
        media_type: String(goodbye.media_type ?? "").toLowerCase(),
        buttons: Array.isArray(goodbye.buttons) ? goodbye.buttons : [],
    };
}

// "started" check from DB: doc exists => started
async function hasUserStartedBot(userId) {
    if (!userId) return false;
    const doc = await user_setting_module.findOne({ user_id: Number(userId) }).select("_id").lean();
    return !!doc?._id;
}

// last goodbye message id from messages_module (latest sent_at)
async function getLastGoodbyeMessageId(chatId, ownerDocId) {
    const last = await messages_module
        .findOne({
            userDB_id: ownerDocId,
            group_id: Number(chatId),
            type: "goodbye",
            status: "pending",
        })
        .sort({ sent_at: -1 })
        .select("message_id")
        .lean();

    return last?.message_id ? Number(last.message_id) : null;
}

async function scheduleAutoDeleteIfEnabled(chatId, sentMessageId, ownerDoc, chatIdStr) {
    try {
        if (!sentMessageId || !ownerDoc?._id) return;
        if (!messages_module) return;

        // user_settings_module schema uses: settings -> deletesettings (not delete_settings) [file:2]
        const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
        const del = chatSettings?.deletesettings || {};
        const scheduled = del?.scheduled || {};
        const cfg = scheduled?.goodbye || null;

        const DEFAULT_TTL_MS = 10 * 60 * 1000;

        const enabled = typeof cfg?.enabled === "boolean" ? cfg.enabled : true;
        const ttlMs = typeof cfg?.timems === "number" && cfg.timems > 0 ? cfg.timems : DEFAULT_TTL_MS;
        if (!enabled) return;

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

async function scheduleAutoDeleteIfEnabled_custom(chatId, sentMessageId, ownerDoc, chatIdStr) {
    try {
        if (!sentMessageId || !ownerDoc?._id) return;
        if (!messages_module) return;

        // user_settings_module schema uses: settings -> deletesettings (not delete_settings) [file:2]
        const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
        const del = chatSettings?.deletesettings || {};
        const scheduled = del?.scheduled || {};
        const cfg = scheduled?.goodbye || null;

        const DEFAULT_TTL_MS = 10 * 60 * 1000;

        const enabled = typeof cfg?.enabled === "boolean" ? cfg.enabled : true;
        const ttlMs = typeof cfg?.timems === "number" && cfg.timems > 0 ? cfg.timems : DEFAULT_TTL_MS;
        if (!enabled) return;

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
                    type: "custom",
                    status: "pending",
                },
            },
            { upsert: true }
        );
    } catch (e) {
        console.error("Error scheduling auto-delete (goodbye):", e);
    }
}

async function sendGoodbye(ctx, leftMember) {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const chatId = chat.id;
    const chatIdStr = String(chatId);

    // Find owner doc where goodbye enabled for this chat
    const ownerDoc = await user_setting_module
        .findOne({
            [`settings.${chatIdStr}.goodbye.enabled`]: true,
        })
        .lean();

    if (!ownerDoc) return;

    const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
    const goodbyeCfg = getGoodbyeSettings(chatSettings);
    if (!goodbyeCfg.enabled) return;

    const userId = leftMember?.id;
    if (!userId) return;

    const pmAllowed = !!goodbyeCfg.is_pm_allowed;
    const deleteLast = !pmAllowed && !!goodbyeCfg.delete_last;

    // ✅ placeholders only from ALLOWED_PLACEHOLDERS
    const text = applyPlaceholders(goodbyeCfg.text, ctx, leftMember);
    const inlineKeyboard = buildInlineKeyboard(goodbyeCfg.buttons, ctx, leftMember);

    const media = goodbyeCfg.media;
    const mediaType = goodbyeCfg.media_type;

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
            // can't DM -> skip
        }
        return;
    }

    // ---- Group send ----
    if (deleteLast) {
        const lastMsgId = await getLastGoodbyeMessageId(chatId, ownerDoc._id);
        if (lastMsgId) {
            // 1) Delete from Telegram
            try {
                await ctx.telegram.deleteMessage(chatId, lastMsgId);
            } catch { }

            // 2) Also delete its DB tracking row (auto_delete_messages)
            // Using unique pair group_id + message_id as per schema. [file:1]
            try {
                await messages_module.deleteOne({
                    group_id: Number(chatId),
                    message_id: Number(lastMsgId),
                });
            } catch { }
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
        await scheduleAutoDeleteIfEnabled(chatId, sentId, ownerDoc, chatIdStr);
    }
}

// ------------------------- Main module -------------------------
module.exports = (bot) => {
    // A) Force bot start enforcement (NO REDIS)
    bot.on("message", async (ctx, next) => {
        let allowNext = true;

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

            // Find owner doc where force bot start is ON (snake_case) [file:2]
            const ownerDoc = await user_setting_module
                .findOne({
                    [`settings.${chatIdStr}.goodbye.is_force_bot_start`]: true,
                })
                .lean();

            if (!ownerDoc) return;

            const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
            const goodbyeCfg = getGoodbyeSettings(chatSettings);
            if (!goodbyeCfg.is_force_bot_start) return;

            // Skip admins
            const admin = await isChatAdmin(ctx, chatId, userId);
            if (admin) return;

            // started check from DB
            const started = await hasUserStartedBot(userId);
            if (started) return;

            // Enforce and block others
            allowNext = false;

            // Delete message
            try {
                await ctx.telegram.deleteMessage(chatId, msg.message_id);
            } catch { }

            const botUser = process.env.BOT_USERNAME_GROUP_HELP_ADVANCE || bot?.botInfo?.username || "this_bot";
            const startLink = `https://t.me/${botUser}?start=force_start`;

            const warnText =
                `${userMentionHTML(from)}, you must start the bot in private chat before you can send messages here.\n\n` +
                `Start now: <a href="${startLink}">@${escapeHTML(botUser)}</a>`;

            const sent = await ctx.telegram.sendMessage(chatId, warnText, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });
            const sentId = sent?.message_id || sent?.messageId;
            if (sentId) {
                await scheduleAutoDeleteIfEnabled_custom(chatId, sentId, ownerDoc, chatIdStr);
            }
        } catch (err) {
            console.error("Force bot start listener error:", err);
        } finally {
            if (allowNext && typeof next === "function") {
                try {
                    await next();
                } catch { }
            }
        }
    });

    // B1) Goodbye via left_chat_member
    bot.on("left_chat_member", async (ctx) => {
        try {
            const left = ctx.message?.left_chat_member;
            if (!left?.id) return;

            // skip bot itself leaving
            if (left?.is_bot && bot?.botInfo?.username && left.username === bot.botInfo.username) return;

            await sendGoodbye(ctx, left);
        } catch (err) {
            console.error("left_chat_member goodbye error:", err);
        }
    });
};