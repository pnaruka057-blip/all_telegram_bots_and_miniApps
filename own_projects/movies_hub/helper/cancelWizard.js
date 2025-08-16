const { Markup } = require('telegraf');
const menu_btn_admin = require('../buttons/menu_btn_admin');

async function cancelWizard(ctx, prefix) {
    // Delete current message if exists
    const keys = Object.keys(ctx.session);
    const lastKey = keys.find(key => key.endsWith(`${prefix}_message_id`));
    if (lastKey) {
        try {
            await ctx.deleteMessage(ctx.session[lastKey]);
        } catch (err) {
            console.error("Error deleting old message on back:", err.message);
        }
        delete ctx.session[lastKey];
    }
    await ctx.reply("❌ Process cancelled.", Markup.removeKeyboard());
    await menu_btn_admin(ctx);
    return ctx.scene.leave();
}

module.exports = cancelWizard;