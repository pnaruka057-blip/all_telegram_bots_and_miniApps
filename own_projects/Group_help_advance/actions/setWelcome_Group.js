const { Markup } = require("telegraf");
const user_setting_module = require("../models/user_settings_module");
const messages_module = require("../models/messages_module");
const { ALLOWED_PLACEHOLDERS } = require("../helpers/const");

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
    const name = escapeHTML(
        [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() || user?.username || "User"
    );
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

// ONLY allowed placeholders
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

    for (const key of ALLOWED_PLACEHOLDERS || []) {
        const val = map[key] ?? "";
        const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
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

// ------------------------- DB helpers -------------------------

async function getLastWelcomeMessageId(chatId, ownerDocId) {
    const last = await messages_module
        .findOne({
            userDB_id: ownerDocId,
            group_id: Number(chatId),
            type: "welcome",
            status: "pending",
        })
        .sort({ sent_at: -1 })
        .select("message_id")
        .lean();

    return last?.message_id ? Number(last.message_id) : null;
}

async function deleteWelcomeMessageAndDoc(ctx, chatId, messageId) {
    if (!chatId || !messageId) return;

    try {
        await ctx.telegram.deleteMessage(Number(chatId), Number(messageId));
    } catch { }

    // Always try to delete DB doc too (best-effort)
    try {
        await messages_module.deleteOne({
            group_id: Number(chatId),
            message_id: Number(messageId),
        });
    } catch { }
}

async function scheduleAutoDeleteIfEnabled(chatId, sentMessageId, ownerDoc, chatIdStr) {
    try {
        if (!sentMessageId || !ownerDoc?._id) return;

        // deletesettings.scheduled.welcome.{enabled,timems} [file:2]
        const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
        const del = chatSettings?.deletesettings || {};
        const scheduled = del?.scheduled || {};
        const cfg = scheduled?.welcome || null;

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

// store every join in welcome.first_join using $addToSet
async function recordFirstJoinUser(ownerDocId, chatIdStr, userId) {
    try {
        await user_setting_module.updateOne(
            { _id: ownerDocId },
            { $addToSet: { [`settings.${chatIdStr}.welcome.first_join`]: Number(userId) } }
        );
    } catch (e) {
        console.error("first_join record error:", e);
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

            // Find owner doc with welcome enabled for this chat [file:2]
            const ownerDoc = await user_setting_module
                .findOne({ [`settings.${chatIdStr}.welcome.enabled`]: true })
                .lean();

            if (!ownerDoc) return;

            const chatSettings = ownerDoc?.settings?.get?.(chatIdStr) || ownerDoc?.settings?.[chatIdStr] || {};
            const welcome = chatSettings?.welcome || {};
            if (!welcome?.enabled) return;

            const modeRaw = String(welcome.mode || "always").toLowerCase(); // "always" | "first" [file:2]
            const deleteLast = !!welcome.delete_last; // snake_case [file:2]

            const firstJoinArr = Array.isArray(welcome.first_join) ? welcome.first_join : [];

            for (const member of newMembers) {
                // skip bot itself
                if (member?.is_bot && bot?.botInfo?.username && member.username === bot.botInfo.username) continue;

                const userId = member?.id;
                if (!userId) continue;

                const alreadyInFirstJoin = firstJoinArr.includes(Number(userId));

                // ✅ requirement: welcome enabled true => always record join
                // (only add if not already there)
                if (!alreadyInFirstJoin) {
                    await recordFirstJoinUser(ownerDoc._id, chatIdStr, userId);
                }

                // ✅ requirement: track all members
                await user_setting_module.updateOne(
                    { _id: ownerDoc._id },
                    { $addToSet: { [`settings.${chatIdStr}.members_ids`]: Number(userId) } }
                );

                // ✅ if mode is "first" and user already recorded => do not send welcome
                if (modeRaw === "first" && alreadyInFirstJoin) {
                    continue;
                }

                // delete previous welcome if enabled (NO redis)
                if (deleteLast) {
                    const lastMsgId = await getLastWelcomeMessageId(chatId, ownerDoc._id);
                    if (lastMsgId) {
                        await deleteWelcomeMessageAndDoc(ctx, chatId, lastMsgId);
                    }
                }

                const text = applyPlaceholders(welcome.text || "", ctx, member);
                const inlineKeyboard = buildInlineKeyboard(welcome.buttons || [], ctx, member);

                const media = welcome.media;
                const mediaType = String(welcome.media_type || "").toLowerCase(); // snake_case [file:2]

                const hasMedia = !!media && !!mediaType;
                const hasText = !!String(text || "").trim();
                const hasButtons = !!(inlineKeyboard && inlineKeyboard.length);
                if (!hasMedia && !hasText && !hasButtons) continue;

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
        } catch (err) {
            console.error("setWelcome_Group listener error:", err);
        }
    });
};
