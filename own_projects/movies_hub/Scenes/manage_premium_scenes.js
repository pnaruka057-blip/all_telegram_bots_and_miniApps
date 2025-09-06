const { Scenes, Markup } = require("telegraf");
const moment = require("moment");
const users_module = require("../models/users_module");
const escapeMarkdownV2 = require("../helpers/escapeMarkdownV2");
const cancelWizard = require("../helpers/cancelWizard");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const start_message = require("../helpers/start_message");
const bot = require("../bot_index");

const managePremiumUsersWizard = new Scenes.WizardScene(
    "MANAGE_PREMIUM_USERS_SCENE",

    async (ctx) => {
        const message = await ctx.reply("🔍 Please enter Telegram Username to manage:", Markup.keyboard([["❌ Cancel"]]).resize());
        ctx.session.premium_user_find_message_id = message.message_id
        return ctx.wizard.next();
    },

    async (ctx) => {

        if (ctx.message.text === "❌ Cancel") return cancelWizard(ctx, "premium_user_find");

        try {
            if (ctx.session.premium_user_find_message_id) {
                await ctx.deleteMessage(ctx.session.premium_user_find_message_id);
                delete ctx.session.premium_user_find_message_id
            }
        } catch { }

        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!ctx.message || !ctx.message.text) {
            const msg = await ctx.reply("❗ Please enter a valid username:", Markup.keyboard([["❌ Cancel"]]).resize());
            ctx.session.premium_user_find_message_id = msg.message_id;
            return;
        }

        const user_name = ctx.message.text.trim().replace("@", "");
        const user = await users_module.findOne({ username: user_name });

        if (!user) {
            const msg = await ctx.reply("❌ User not found. Please try again:", Markup.keyboard([["❌ Cancel"]]).resize());
            ctx.session.premium_user_find_message_id = msg.message_id;
            return;
        }

        ctx.session.editUser = user;

        const info = `
*👤 User Info*
🆔 *User ID:* \`${user.user_id}\`
👨‍💼 *Name:* ${escapeMarkdownV2(user.name)}
🔗 *Username:* @${escapeMarkdownV2(user.username)}
🌐 *Language:* ${escapeMarkdownV2(user.language)}
💎 *Premium:* *${user.isPremium ? "✅ Active" : "❌ Inactive"}*
📅 *Start:* ${user.premium_start_date ? "`" + moment(user.premium_start_date).format("DD MMM YYYY") + "`" : "_Not Set_"}
📆 *End:* ${user.premium_end_date ? "`" + moment(user.premium_end_date).format("DD MMM YYYY") + "`" : "_Not Set_"}
`;

        const sent = await ctx.replyWithMarkdownV2(info, Markup.inlineKeyboard([
            [{ text: user.isPremium ? "🔴 Remove Premium" : "🟢 Make Premium", callback_data: `TOGGLE_PREMIUM_${user.user_id}` }],
            [{ text: "📅 Set Premium Start Date", callback_data: `SET_PREMIUM_START_${user.user_id}` }],
            [
                { text: "⬅ Back", callback_data: `GO_BACK` },
                { text: "❌ Cancel", callback_data: `CANCEL_WIZARD` }
            ]
        ]));

        ctx.session.premium_user_find_message_id = sent.message_id;
        return ctx.wizard.next();
    },

    async (ctx) => {
        if (!ctx.callbackQuery) return;

        const action = ctx.callbackQuery.data;

        if (action === "GO_BACK") {
            await ctx.answerCbQuery();
            return ctx.scene.enter("MANAGE_PREMIUM_USERS_SCENE"); // restart
        }

        if (action === "CANCEL_WIZARD") {
            await ctx.answerCbQuery("❌ Cancelled");
            await ctx.deleteMessage();
            await menu_btn_admin(ctx);
            return ctx.scene.leave();
        }

        // If any other button is pressed, leave the wizard
        await ctx.answerCbQuery();
        return ctx.scene.leave();
    },
);

module.exports = managePremiumUsersWizard;
