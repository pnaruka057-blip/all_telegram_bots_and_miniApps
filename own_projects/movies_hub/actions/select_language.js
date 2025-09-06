const users_module = require("../models/users_module");
const menu_btn_users = require("../buttons/menu_btn_users");

module.exports = (bot, Markup) => {
    bot.action("CHANGE_LANGUAGE", async (ctx) => {
        await ctx.answerCbQuery();

        ctx.editMessageText("Please select your preferred language:", {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🇬🇧 English", callback_data: "LANG_EN" },
                        { text: "🇮🇳 Hindi", callback_data: "LANG_HI" }
                    ],
                    [
                        { text: "🇮🇳 Tamil", callback_data: "LANG_TM" },
                        { text: "🇮🇳 Telugu", callback_data: "LANG_TE" }
                    ],
                    [
                        { text: "⬅ Back", callback_data: "GOBACK_TO_MENU" }
                    ]
                ]
            }
        });
    });

    bot.action("GOBACK_TO_MENU", async (ctx) => {
        await menu_btn_users(ctx);
    });

    bot.action("LANG_EN", async (ctx) => {
        await users_module.updateOne({ user_id: ctx.from.id }, { language: "English" });
        menu_btn_users(ctx);
        ctx.answerCbQuery("Language set to English");
    });

    bot.action("LANG_HI", async (ctx) => {
        await users_module.updateOne({ user_id: ctx.from.id }, { language: "Hindi" });
        menu_btn_users(ctx);
        ctx.answerCbQuery("Language set to Hindi");
    });

    bot.action("LANG_TM", async (ctx) => {
        await users_module.updateOne({ user_id: ctx.from.id }, { language: "Tamil" });
        menu_btn_users(ctx);
        ctx.answerCbQuery("Language set to Tamil");
    });

    bot.action("LANG_TE", async (ctx) => {
        await users_module.updateOne({ user_id: ctx.from.id }, { language: "Telugu" });
        menu_btn_users(ctx);
        ctx.answerCbQuery("Language set to Telugu");
    });

    const waitingForLanguage = new Map();
    bot.action("LANG_REQUEST", async (ctx) => {
        waitingForLanguage.set(ctx.from.id, true);
        ctx.session.message_id = ctx.update.callback_query.message.message_id;
        await ctx.editMessageText("Please type your preferred language in the chat. The admin will review your request.");
    });

    bot.on("text", async (ctx, next) => {
        const userId = ctx.from.id;
        const preferredLanguage = ctx.message.text.trim();

        if (!waitingForLanguage.has(userId)) return next();

        const reportMsg = `⚠️ *Suspicious Language Entry*\n\n👤 User: [${ctx.from.first_name}](tg://user?id=${ctx.from.id})\n🆔 ID: ${ctx.from.id}\n📝 Message: \`${preferredLanguage}\``;

        await ctx.telegram.sendMessage(process.env.ADMIN_ID, reportMsg, {
            parse_mode: "Markdown",
        });

        // Delete previous message where user was asked to enter language
        if (ctx.session.message_id) {
            try {
                await ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.message_id);
            } catch (err) {
                console.error("❌ Error deleting message:", err.message);
            }
        }

        await menu_btn_users(ctx);

        waitingForLanguage.delete(userId);
    });
}