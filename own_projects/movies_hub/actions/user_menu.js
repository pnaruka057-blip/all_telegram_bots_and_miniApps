const menu_btn_users = require("../buttons/menu_btn_users");

module.exports = (bot) => {
    bot.action('MAIN_MENU', async (ctx) => {
        try {
            await menu_btn_users(ctx);
        } catch (err) {
            console.error("Error in MAIN_MENU action:", err);
            await ctx.reply("⚠️ An error occurred while navigating to the main menu.");
        }
    });
}