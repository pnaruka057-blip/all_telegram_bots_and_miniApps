
module.exports = (bot) => {
    // Action to enter show adding wizard
    bot.action("ADD_SHOW_ADMIN_PANEL", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.deleteMessage();
            await ctx.scene.enter("ADD_SHOW_SCENE");
        } catch (err) {
            console.error("❌ Error:", err);
            await ctx.reply("❌ Something went wrong!");
        }
    });
};
