const { Markup } = require("telegraf");
const escapeMarkdownV2 = require("../helpers/escapeMarkdownV2");

module.exports = async (ctx) => {
    const adminMessage = `Hi *${escapeMarkdownV2(ctx.from.first_name)}* 👋\n\nYou are the admin of this bot\\. Use the buttons below to manage the bot:`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🎬 Add Movie", "ADD_MOVIE_ADMIN_PANEL"), Markup.button.callback("📝 Edit Movie", "EDIT_MOVIE_ADMIN_PANEL")],
        [Markup.button.callback("📺 Add Show", "ADD_SHOW_ADMIN_PANEL"), Markup.button.callback("📝 Edit Show", "EDIT_SHOW_ADMIN_PANEL")],
        // [Markup.button.callback("⭐ Manage Premium Users", "MANAGE_PREMIUM_USERS")],
        [
            Markup.button.webApp(
                "🎯 Users All Requestes",
                `${process.env.GLOBLE_DOMAIN || ""}/${process.env.MOVIES_HUB_TOKEN}/movies-hub/view_requests`
            )
        ],
        // [Markup.button.callback("🛠️ Manage Subadmins", "MANAGE_SUBADMINS")],
        [Markup.button.callback("🌐 Language Requests", "VIEW_LANGUAGE_REQUESTS")],
        [Markup.button.callback("📩 User Messages", "VIEW_USER_MESSAGES")],
    ]);

    let message_id;
    try {
        ctx.session = {};
        message_id = await ctx.editMessageText(adminMessage, {
            parse_mode: "MarkdownV2",
            reply_markup: keyboard.reply_markup,
        });
    } catch (error) {
        message_id = await ctx.reply(adminMessage, {
            parse_mode: "MarkdownV2",
            reply_markup: keyboard.reply_markup,
        });
    } finally {
        ctx.session.admin_menu_message_id = message_id.message_id;
    }
};
