const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const encode_payload = require("../helpers/encode_payload");
const payload = `group-help-advance:privacy-policy`;
const miniAppLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encode_payload(payload)}`;

// simple HTML escaper for user-provided text
function escapeHTML(input) {
    return String(input || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

module.exports = async (ctx) => {
    const nameSafe = escapeHTML(ctx.from?.first_name || ctx.from?.username || "there");

    const text = `👋 Hi ${nameSafe}!\n\n<b>Group Help Advance</b> is the most complete Bot to help you <b>manage</b> your <b>Groups</b> and <b>Channels</b> easily and safely!\n\n👉 <b>Add me in a Supergroup or Channel</b> and promote me as Admin to let me get in action!\n\n❓ <b>WHICH ARE THE COMMANDS?</b> \nPress /help to see all the commands and how they work!\n\n<a href="${miniAppLink}">Privacy policy</a>`;

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
        disable_web_page_preview: true, // <- link preview OFF
        ...keyboard
    });
};