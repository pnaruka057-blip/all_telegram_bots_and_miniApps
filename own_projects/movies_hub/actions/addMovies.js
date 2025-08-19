
module.exports = (bot) => {
    // Action to enter movie adding wizard
    bot.action("ADD_MOVIE_ADMIN_PANEL", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.deleteMessage();
            await ctx.scene.enter("ADD_MOVIE_SCENE");
        } catch (err) {
            console.error("❌ Error:", err);
            await ctx.reply("❌ Something went wrong!");
        }
    });

};
