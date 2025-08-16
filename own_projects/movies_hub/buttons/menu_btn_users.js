const { Markup } = require("telegraf");
const escapeMarkdownV2 = require("../helper/escapeMarkdownV2");

module.exports = async (ctx) => {
    const userMessage = `*Hi ${escapeMarkdownV2(ctx.from.first_name)}* 👋\n\n🎉 *Welcome to your ultimate entertainment hub\\!* Here, you can find your favorite 🎬 *Movies* and 📺 *Shows* absolutely *FREE* — no hidden charges, no premium, just pure content love\\. ❤️\n\n👇 Use the buttons below to get started:`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Find Movies", "FIND_MOVIES"), Markup.button.callback("📺 Find Shows", "FIND_SHOWS")],
        [Markup.button.callback("📘 Help Guide", "HELP_GUIDE")],
        [Markup.button.url("📢 Join Official Channel", `https://t.me/${process.env.CHANNEL_ID_MOVIEHUB}`)],
        [Markup.button.callback("🌐 Change Language", "CHANGE_LANGUAGE")],
        [Markup.button.callback("💸 Earn Money with Us 💸", "USER_EARN_MONEY")]
    ]);
    
    try {
        ctx.session = {};
        await ctx.editMessageText(userMessage, { parse_mode: "MarkdownV2", ...keyboard });
    } catch (error) {
        await ctx.reply(userMessage, { parse_mode: "MarkdownV2", ...keyboard });
    }
};
