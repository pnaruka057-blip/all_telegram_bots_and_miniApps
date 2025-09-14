const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner"); // ✅ import helper

module.exports = (bot) => {
    bot.action(/^GROUP_SETTINGS_(.+)$/, async (ctx) => {
        try {
            const userId = ctx.from.id;
            const chatIdRaw = ctx.match[1];
            const chatId = Number(chatIdRaw);
            const chatIdStr = String(chatIdRaw);

            // ✅ Validate with helper (chat info + owner check)
            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return; // agar validation fail hua to stop karo

            // ✅ Settings menu
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("📜 Regulation", `SET_REGULATION_${chatIdStr}`), Markup.button.callback("🧯 Anti-Spam", `SET_ANTISPAM_${chatIdStr}`)],
                [Markup.button.callback("💬 Welcome", `SET_WELCOME_${chatIdStr}`), Markup.button.callback("🌊 Anti-Flood", `SET_ANTIFLOOD_${chatIdStr}`)],
                [Markup.button.callback("🖐️ Goodbye", `SET_GOODBYE_${chatIdStr}`), Markup.button.callback("🕉 Alphabets", `SET_ALPHABETS_${chatIdStr}`)],
                [Markup.button.callback("🧠 Captcha", `SET_CAPTCHA_${chatIdStr}`), Markup.button.callback("🪓 Checks", `SET_CHECKS_${chatIdStr}`)],
                [Markup.button.callback("🆘 @Admin", `SET_ATADMIN_${chatIdStr}`), Markup.button.callback("🔒 Blocks", `SET_BLOCKS_${chatIdStr}`)],
                [Markup.button.callback("🎞️ Media", `SET_MEDIA_${chatIdStr}`), Markup.button.callback("🚫 Porn", `SET_PORN_${chatIdStr}`)],
                [Markup.button.callback("❗ Warns", `SET_WARNS_${chatIdStr}`), Markup.button.callback("🌙 Night", `SET_NIGHT_${chatIdStr}`)],
                [Markup.button.callback("🔔 Tag", `SET_TAG_${chatIdStr}`), Markup.button.callback("🔗 Link", `SET_LINK_${chatIdStr}`)],
                [Markup.button.callback("📨 Approval mode", `SET_APPROVAL_${chatIdStr}`)],
                [Markup.button.callback("🗑️ Deleting Messages", `SET_DELETING_${chatIdStr}`)],
                [Markup.button.callback("🏳️ Lang", `SET_LANG_${chatIdStr}`), Markup.button.callback("✅ Close", `CLOSE_SETTINGS_${chatIdStr}`), Markup.button.callback("▶️ Other", `SET_OTHER_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", "MANAGE_GROUPS")]
            ]);

            const text = `⚙️ <b>SETTINGS</b>\nGroup: <code>${chat.title || chatIdStr}</code>\n\n<i>Select one of the settings that you want to change.</i>`;

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
        } catch (err) {
            console.error("❌ Error in GROUP_SETTINGS handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while opening settings. Please try again.");
            } catch (e) { }
        }
    });
};
