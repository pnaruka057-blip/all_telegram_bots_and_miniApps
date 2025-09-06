const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");

module.exports = async (ctx) => {
    const text = `👋 Hi ${ctx.from.first_name}!\n\n<b>Group Help Advanced</b> is the most complete Bot to help you <b>manage</b> your <b>Groups</b> and <b>Channels</b> easily and safely!\n\n👉 <b>Add me in a Supergroup or Channel</b> and promote me as Admin to let me get in action!\n\n❓ <b>WHICH ARE THE COMMANDS?</b> \nPress /help to see all the commands and how they work!\n\n<a href="https://your-privacy-policy-link.com">Privacy policy</a>`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.url("➕ Add me to a Group", `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}?startgroup=true`)],
        [Markup.button.url("➕ Add me to a Channel", `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}?startchannel=true`)],
        [Markup.button.callback("⚙️ Manage Group Settings ✍️", "MANAGE_GROUPS")],
        [Markup.button.callback("⚙️ Manage Channel Settings ✍️", "MANAGE_CHANNELS")],
        [
            Markup.button.url("👥 Group", "https://t.me/yourgroup"),
            Markup.button.url("📢 Channel", "https://t.me/yourchannel")
        ],
        [
            Markup.button.url("🔴 Support", "https://t.me/your_support"),
            Markup.button.callback("ℹ️ Information ...", "info")
        ],
        [Markup.button.callback("🇬🇧 Languages 🇬🇧", "languages")]
    ]);

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        ...keyboard
    });
};
