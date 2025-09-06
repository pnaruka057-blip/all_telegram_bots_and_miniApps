const moment = require("moment-timezone");
const escapeMarkdownV2 = require("../helpers/escapeMarkdownV2");
const other_modules = require("../models/other_module");
const users_module = require("../models/users_module");
const menu_btn_admin = require("../buttons/menu_btn_admin");

module.exports = (bot) => {
    bot.action("MANAGE_PREMIUM_USERS", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.deleteMessage();
            await ctx.scene.enter("MANAGE_PREMIUM_USERS_SCENE");
        } catch (err) {
            console.error("❌ Error:", err);
            await ctx.reply("❌ Something went wrong!");
        }
    });

    bot.action(/^TOGGLE_PREMIUM_(.+)$/, async (ctx) => {
        try {
            const userId = ctx.match[1];
            const user = await users_module.findOne({ user_id: userId });
            if (!user) return ctx.reply("User not found!");
            // If activating premium and no start/end date, take input
            if (!user.isPremium && (!user.premium_start_date || !user.premium_end_date)) {
                await ctx.answerCbQuery();
                ctx.session.tempUserIdForPremium = userId;
                await ctx.deleteMessage();
                return ctx.reply("Please enter the premium start date in format: `01 Jan 2025`", {
                    parse_mode: "Markdown",
                });
            }


            // Toggle premium
            user.isPremium = !user.isPremium;
            await user.save();
            await ctx.answerCbQuery("Premium status updated!");

            const userInfo = generateUserInfo(user);
            await ctx.editMessageText(userInfo, {
                parse_mode: "MarkdownV2",
                reply_markup: generateInlineKeyboard(user)
            });

        } catch (error) {
            console.error("Toggle Premium Error:", error);
            ctx.reply("Something went wrong!");
        }
    });

    bot.action(/^SET_PREMIUM_START_(\d+)$/, async (ctx) => {
        try {
            const userId = ctx.match[1];
            const user = await users_module.findOne({ user_id: userId });
            if (!user) return ctx.reply("User not found!");
            ctx.session.tempUserIdForPremium = userId;
            await ctx.deleteMessage();
            return ctx.reply("Please enter the premium start date in format: `01 Jan 2025`", {
                parse_mode: "Markdown",
            });
        } catch (error) {
            console.error("Error in SET_PREMIUM_START action:", error);
            ctx.reply("⚠️ Something went wrong. Please try again later.");
        }
    });

    bot.on("text", async (ctx, next) => {
        if (!ctx.session.tempUserIdForPremium) return next();

        const userId = ctx.session.tempUserIdForPremium;
        const user = await users_module.findOne({ user_id: userId });
        if (!user) {
            delete ctx.session.tempUserIdForPremium;
            return ctx.reply("User not found!");
        }

        const dateStr = ctx.message.text.trim();
        const parsedDate = moment.tz(dateStr, "DD MMM YYYY", true, "Asia/Kolkata");

        if (!parsedDate.isValid()) {
            return ctx.reply("❌ Invalid date format! Please use: `01 Jan 2025`", {
                parse_mode: "Markdown",
            });
        }

        const plans = await other_modules.find({ document_name: "plan" });
        if (!plans.length) return ctx.reply("No plans found!");

        ctx.session.tempPremiumStartDate = parsedDate.startOf("day").toDate();
        ctx.session.user_id = userId;
        delete ctx.session.tempUserIdForPremium;

        const buttons = plans.map(plan => [{
            text: `₹${plan.plan_price} - ${plan.plan_duration} days`,
            callback_data: `SELECT_PLAN_${plan._id}`
        }]);

        await ctx.reply("Please select a plan to set premium end date:", {
            reply_markup: {
                inline_keyboard: buttons
            }
        });
    });

    bot.action(/^SELECT_PLAN_(.+)$/, async (ctx) => {
        try {
            const planId = ctx.match[1];
            const plan = await other_modules.findById(planId);
            if (!plan) return ctx.reply("Plan not found!");

            const user = await users_module.findOne({ user_id: ctx.session.user_id });
            if (!user) return ctx.reply("User not found!");

            const startDate = ctx.session.tempPremiumStartDate;
            if (!startDate) return ctx.reply("Start date not set!");

            const endDate = moment(startDate).add(plan.plan_duration, "days").toDate();

            user.isPremium = true;
            user.premium_start_date = startDate;
            user.premium_end_date = endDate;
            await user.save();

            await ctx.answerCbQuery("Premium activated!");

            // Clean up
            delete ctx.session.tempPremiumStartDate;
            delete ctx.session.user_id;

            const userInfo = generateUserInfo(user);
            await ctx.editMessageText(userInfo, {
                parse_mode: "MarkdownV2",
                reply_markup: generateInlineKeyboard(user)
            });
        } catch (err) {
            console.error("SELECT_PLAN error:", err);
            ctx.reply("Something went wrong!");
        }
    });

    bot.action("FIND_USER_FOR_PREMIUM", async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.deleteMessage();
        await ctx.scene.enter("MANAGE_PREMIUM_USERS_SCENE"); // restart the wizard
    });

    bot.action("CANCEL_WIZARD", async (ctx) => {
        await ctx.answerCbQuery("❌ Cancelled");
        await ctx.deleteMessage();
        await menu_btn_admin(ctx);
    });
};

function generateUserInfo(user) {
    return `
👤 *User Details:*
🆔 *User ID:* \`${user.user_id}\`
👨‍💼 *Name:* ${escapeMarkdownV2(user.name)}
🔗 *Username:* @${escapeMarkdownV2(user.username)}
🌐 *Language:* ${escapeMarkdownV2(user.language)}
💎 *Premium:* ${user.isPremium ? "✅ Active" : "❌ Inactive"}
🚀 *Start:* ${user.premium_start_date ? "`" + moment(user.premium_start_date).format("DD MMM YYYY") + "`" : "_Not Set_"}
⏰ *End:* ${user.premium_end_date ? "`" + moment(user.premium_end_date).format("DD MMM YYYY") + "`" : "_Not Set_"}
    `;
}

function generateInlineKeyboard(user) {
    return {
        inline_keyboard: [
            [
                { text: user.isPremium ? "🔴 Remove Premium" : "🟢 Make Premium", callback_data: `TOGGLE_PREMIUM_${user.user_id}` }
            ],
            [
                { text: "📅 Set Premium Start Date", callback_data: `SET_PREMIUM_START_${user.user_id}` }
            ],
            [
                { text: "🔍 Find User", callback_data: `FIND_USER_FOR_PREMIUM` },
                { text: "❌ Cancel", callback_data: `CANCEL_WIZARD` }
            ]
        ]
    };
}