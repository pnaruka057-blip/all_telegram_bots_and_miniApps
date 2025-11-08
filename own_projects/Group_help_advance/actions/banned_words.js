const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// normalize
const norm = s => s.trim().toLowerCase();
const splitLines = text => text.split(/\r?\n/).map(norm).filter(Boolean);

// DB helpers
async function getWordFilter(userId, chatIdStr) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    return doc?.settings?.[chatIdStr]?.word_filter || {};
}
async function setPath(userId, chatIdStr, path, value) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.${path}`]: value } },
        { upsert: true }
    );
}
async function addWords(userId, chatIdStr, words) {
    if (!words.length) return;
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $addToSet: { [`settings.${chatIdStr}.word_filter.words`]: { $each: words } } },
        { upsert: true }
    );
}
async function removeWords(userId, chatIdStr, words) {
    if (!words.length) return;
    await user_setting_module.updateOne(
        { user_id: userId },
        { $pull: { [`settings.${chatIdStr}.word_filter.words`]: { $in: words } } }
    );
}

function penaltyLabel(p) {
    return (p || "off").charAt(0).toUpperCase() + (p || "off").slice(1);
}

async function renderWordsMenu(ctx, chatIdStr, userId, isOwner) {
    ctx.session = {};
    const v = await getWordFilter(userId, chatIdStr);
    const penalty = v.penalty || "off";

    // default messages check = true unless explicitly false
    const msgOn = v.message_check !== false;
    const delOn = !!v.delete_messages;
    const uOn = !!v.username_check;
    const nOn = !!v.name_check;
    const bOn = !!v.bio_check;

    // For message text (Yes/No)
    const yn = x => (x ? "Yes ✅" : "No ❌");
    // For button labels (✓/✗)
    const tick = x => (x ? "✓" : "✗");

    const cnt = Array.isArray(v.words) ? v.words.length : 0;

    const text =
        `🔤 <b>Banned Words</b>\n\n` +
        `From this menu you can set a punishment for users who use the words you choose to ban.\n\n` +
        `<b>Penalty</b>: ${penaltyLabel(penalty)}\n` +
        `<b>Messages</b>: ${yn(msgOn)}\n` +
        `<b>Username check</b>: ${yn(uOn)}\n` +
        `<b>Name check</b>: ${yn(nOn)}\n` +
        `<b>User bio check</b>: ${yn(bOn)}\n` +
        `<b>Deletion</b>: ${yn(delOn)}\n` +
        `<b>Words</b>: ${cnt}\n\n` +
        `<b>How it works</b>\n` +
        `• <b>Messages</b>: Scans message text and media captions for any banned word.\n` +
        `• <b>Username</b>: Also scans the sender’s <code>@username</code> when they send a message for any banned word.\n` +
        `• <b>Name</b>: Also scans the sender’s display name when they send a message for any banned word.\n` +
        `• <b>Bio</b>: Also scans the sender’s profile bio for any banned word.\n` +
        `• <b>Deletion</b>: If enabled, the offending message is removed before action.\n` +
        `• <b>Penalty</b>: Chooses the action (Off/Warn/Kick/Mute/Ban) after a match.\n\n` +
        `<i>Select button to config this setting for <b>${isOwner?.title || chatIdStr}</b>.</i>`;

    const rows = [
        // Inline scope toggles in same menu (keep ✓/✗ compact labels)
        [Markup.button.callback(`${tick(msgOn)} Messages`, `BW_SCOPE_messages_${chatIdStr}`), Markup.button.callback(`${tick(uOn)} Username`, `BW_SCOPE_username_${chatIdStr}`)],
        [Markup.button.callback(`${tick(nOn)} Name`, `BW_SCOPE_name_${chatIdStr}`), Markup.button.callback(`${tick(bOn)} Bio`, `BW_SCOPE_bio_${chatIdStr}`)],

        // Penalties
        [Markup.button.callback("❌ Off", `BW_PEN_off_${chatIdStr}`), Markup.button.callback("❗ Warn", `BW_PEN_warn_${chatIdStr}`)],
        [Markup.button.callback("❗ Kick", `BW_PEN_kick_${chatIdStr}`), Markup.button.callback("🔇 Mute", `BW_PEN_mute_${chatIdStr}`)],
        [Markup.button.callback("🚫 Ban", `BW_PEN_ban_${chatIdStr}`)],

        // Delete toggle
        [Markup.button.callback(`${tick(delOn)} Delete Messages`, `BW_DEL_TOGGLE_${chatIdStr}`)],

        // Manage list
        [Markup.button.callback("➕ Add", `BW_ADD_${chatIdStr}`), Markup.button.callback("➖ Remove", `BW_REMOVE_${chatIdStr}`)],
        [Markup.button.callback("📄 List", `BW_LIST_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
    ctx.session ||= {};
    ctx.session._bw_lastMenu = { mid: sent?.message_id, cid: sent?.chat?.id };
}

module.exports = (bot) => {
    // Entry
    bot.action(/^SET_BANNED_WORDS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderWordsMenu(ctx, chatIdStr, userId, ok);
    });

    // Penalty
    bot.action(/^BW_PEN_(off|warn|kick|mute|ban)_(-?\d+)$/, async (ctx) => {
        const pen = ctx.match[1], chatIdStr = ctx.match[2], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await setPath(userId, chatIdStr, "word_filter.penalty", pen);
        try { await ctx.answerCbQuery(`Penalty: ${penaltyLabel(pen)}`); } catch { }
        await renderWordsMenu(ctx, chatIdStr, userId, ok);
    });

    // Delete toggle
    bot.action(/^BW_DEL_TOGGLE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const cur = await getWordFilter(userId, chatIdStr);
        await setPath(userId, chatIdStr, "word_filter.delete_messages", !cur.delete_messages);
        try { await ctx.answerCbQuery(!cur.delete_messages ? "Deletion ON" : "Deletion OFF"); } catch { }
        await renderWordsMenu(ctx, chatIdStr, userId, ok);
    });

    // Scope toggles (same menu)
    bot.action(/^BW_SCOPE_(messages|username|name|bio)_(-?\d+)$/, async (ctx) => {
        const target = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

        const path = {
            messages: "word_filter.message_check",
            username: "word_filter.username_check",
            name: "word_filter.name_check",
            bio: "word_filter.bio_check"
        }[target];

        const cur = await getWordFilter(userId, chatIdStr);
        const currentValue = target === "messages" ? (cur.message_check !== false) : !!cur[`${target}_check`];

        await setPath(userId, chatIdStr, path, !currentValue);
        try { await ctx.answerCbQuery(`${target}: ${!currentValue ? "ON" : "OFF"}`); } catch { }
        await renderWordsMenu(ctx, chatIdStr, userId, ok);
    });

    // Preserve your quick profile toggles if you still need them (optional)
    // (They hit the same paths; can be kept or removed.)

    // Add/Remove flows
    bot.action(/^BW_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session ||= {};
        const text =
            "Okay, now send one or more keywords that will be banned from the Group.\n\n" +
            "In order to send more keywords, send one each line.\n\n" +
            "Example:\nhello\ni will kill you\nyou suck";
        const rows = [[Markup.button.callback("❌ Cancel", `BW_CANCEL_${chatIdStr}`)]];
        const sent = await safeEditOrSend(ctx, text, { reply_markup: { inline_keyboard: rows } }, true);
        ctx.session.await = { mode: "add_words", chatIdStr, promptMessageId: sent };
    });

    bot.action(/^BW_REMOVE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session ||= {};
        const text =
            "Okay, now send one or more words that will no longer be banned from the Group.\n\n" +
            "In order to remove more words send one each line.\n\n" +
            "Example:\nhello\ni will kill you\nyou suck";
        const rows = [[Markup.button.callback("❌ Cancel", `BW_CANCEL_${chatIdStr}`)]];
        const sent = await safeEditOrSend(ctx, text, { reply_markup: { inline_keyboard: rows } }, true);
        ctx.session.await = { mode: "remove_words", chatIdStr, promptMessageId: sent };
    });

    bot.action(/^BW_CANCEL_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        ctx.session = {};
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        try { await ctx.answerCbQuery("Cancelled"); } catch { }
        await renderWordsMenu(ctx, chatIdStr, userId, ok);
    });

    bot.action(/^BW_LIST_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const v = await getWordFilter(userId, chatIdStr);
        const list = (v.words || []).join("\n") || "—";
        const text = `<b>List of banned words in this group:</b>\n\n${list}`;
        const rows = [[Markup.button.callback("⬅️ Back", `SET_BANNED_WORDS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]];
        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
    });

    // Capture text for add/remove
    bot.on("text", async (ctx, next) => {
        const st = ctx.session?.await;
        if (!st || !st.mode || !st.chatIdStr) return next && next();
        const userId = ctx.from.id;
        const chatIdStr = st.chatIdStr;
        const items = splitLines(ctx.message.text);

        if (st.mode === "add_words") {
            await addWords(userId, chatIdStr, items);
            try { await ctx.reply(`Added ${items.length} word(s).`); } catch { }
        } else if (st.mode === "remove_words") {
            await removeWords(userId, chatIdStr, items);
            try { await ctx.reply(`Removed ${items.length} word(s).`); } catch { }
        }

        try { await ctx.deleteMessage(st?.promptMessageId); } catch { }
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (ok) await renderWordsMenu(ctx, chatIdStr, userId, ok);
        return;
    });
};
