const escapeMarkdownV2 = require("../helper/escapeMarkdownV2");
const { Markup } = require("telegraf");
const users_module = require("../model/users_module"); // Assuming users_module_module is named 'users_module'

module.exports = async (ctx, userMessage = '', is_backbtn_show = true) => {
    try {
        const userId = ctx.from.id;
        const user = await users_module.findOne({ user_id: userId });

        let groupInfo = '';

        if (user?.groupsLists?.length > 0) {
            const adminGroups = user.groupsLists.filter(g => g.isAdmin);
            const nonAdminGroups = user.groupsLists.filter(g => !g.isAdmin);

            if (adminGroups.length > 0) {
                groupInfo += `\n\n👑 *Bot as Admin in Groups:*\n`;
                adminGroups.forEach((g, index) => {
                    groupInfo += `${index + 1}\\. ${g.groupName}\n`;
                });
            }

            if (nonAdminGroups.length > 0) {
                groupInfo += `\n🚫 *Bot Not Admin in*\\:\n`;
                nonAdminGroups.forEach((g, index) => {
                    groupInfo += `${index + 1}\\. ${g.groupName}\n`;
                });
            }
        } else {
            groupInfo = `\n\n⚠️ *No group info found*\\. Please add bot to your groups and make it admin for earning\\.`;
        }

        if (!userMessage) {
            userMessage = `🚀 *You\\'re All Set for Earning\\!*

✅ You\\'ve already setup your Link Shortener API\\.

💰 Your earnings will continue as long as the bot is *admin* in your group\\. If you remove the bot or its admin rights, your earning system will stop\\.

👥 If members of your group request and download movies using the bot, you\\'ll keep earning\\!

📢 Invite or add more members to your group to increase your earning potential\\.

🛠️ Want to change your shortener settings\\? Use the button below\\.` + groupInfo;
        }

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔁 Change Shortener", "START_EARN_SETUP")],
            is_backbtn_show ? [Markup.button.callback("🔙 Back", "START_EARN_SETUP"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")] : [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
        ]);

        try {
            await ctx.editMessageText(userMessage, { parse_mode: "MarkdownV2", ...keyboard });
        } catch (error) {
            await ctx.reply(userMessage, { parse_mode: "MarkdownV2", ...keyboard });
        }

    } catch (err) {
        console.error("Error in shortener setup view:", err.message);
        return ctx.reply("❌ Error retrieving your shortener setup info.");
    }
};
