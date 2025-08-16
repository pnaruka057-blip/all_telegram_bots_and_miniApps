const menu_btn_admin = require("../buttons/menu_btn_admin");

module.exports = (bot) => {
    bot.action('ADMIN_MAIN_MENU', async (ctx) => {
        try {
            await menu_btn_admin(ctx);
        } catch (err) {
            console.error("Error in ADMIN_MAIN_MENU action:", err);
            await ctx.reply("⚠️ An error occurred while navigating to the main menu.");
        }
    });
}