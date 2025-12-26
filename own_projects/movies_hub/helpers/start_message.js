// startHandler.js
const { Markup } = require("telegraf");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const menu_btn_users = require("../buttons/menu_btn_users");
const users_module = require("../models/users_module");
const checkUserInChannel = require("./checkUserInChannel");

// HTML-escape helper (safe for parse_mode: "HTML")
function escapeHtml(text = "") {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

module.exports = async (bot, ctx) => {
    try {
        // leave scene if active
        if (ctx.scene?.current) {
            await ctx.scene.leave();
        }

        // brief loading notice
        const sent = await ctx.reply("Preparing your session...");
        await new Promise(res => setTimeout(res, 800));
        await ctx.deleteMessage(sent.message_id).catch(() => { });

        // clear session
        ctx.session = null;

        // admin shortcut
        if (ctx?.from?.id === parseInt(process.env.ADMIN_ID_MOVIEHUB, 10)) {
            return menu_btn_admin(ctx);
        }

        // determine language: prefer Telegram language_code; otherwise default to 'en'
        const langFromTelegram = ctx.from.language_code
            ? String(ctx.from.language_code).split(/[-_]/)[0]
            : null;
        const languageToStore = langFromTelegram || "en";

        // upsert user and set flags
        const updateObj = {
            first_name: ctx.from.first_name || null,
            username: ctx.from.username || null,
            language: languageToStore,
            is_started: true,
            is_blocked: false,
            last_seen: new Date()
        };

        const user = await users_module.findOneAndUpdate(
            { user_id: ctx.from.id },
            { $set: updateObj },
            { new: true, upsert: true }
        );

        // check channel membership (helper may throw, handle gracefully)
        let is_channel_member = false;
        try {
            is_channel_member = await checkUserInChannel(ctx.from.id, bot);
        } catch (err) {
            console.warn("checkUserInChannel error:", err?.message || err);
            is_channel_member = false;
        }

        // route user: if joined -> show user menu, otherwise prompt to join
        if (is_channel_member) {
            return menu_btn_users(ctx);
        }

        // ask user to join backup channel (no language selection)
        const firstNameSafe = escapeHtml(ctx.from.first_name || "User");
        const promptText = `Hello <b>${firstNameSafe}</b>\n\nPlease join our Backup Channel to continue using the bot.`;

        return ctx.reply(promptText, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
                [Markup.button.url("Join Official Channel", `https://t.me/${process.env.CHANNEL_ID_MOVIEHUB}`)],
                [Markup.button.callback("I've Joined", "CHECK_JOIN_BACKUP")]
            ])
        });

    } catch (err) {
        console.error("Start handler fatal error:", err?.message || err);
        try {
            await ctx.reply("An unexpected error occurred. Please try again later.");
        } catch (_) { }
    }
};