const movies_module = require("../models/movies_module");

module.exports = (bot) => {
    // Action to enter movie editing wizard
    bot.action("EDIT_MOVIE_ADMIN_PANEL", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.deleteMessage();
            await ctx.scene.enter("EDIT_MOVIE_SCENE");
        } catch (err) {
            console.error("❌ Error:", err);
            await ctx.reply("❌ Something went wrong!");
        }
    });

    bot.action(/^EDIT_THIS_(.+)$/, async (ctx) => {
        const movieId = ctx.match[1];
        const movie = await movies_module.findById(movieId).lean();
        if (!movie) return ctx.reply("Movie not found!");

        ctx.session.movieId = movieId;
        ctx.session.editMessageId = ctx.update.callback_query.message.message_id;

        // Save movie data to session to prefill later in UPDATE_MOVIE_SCENE
        ctx.scene.enter("UPDATE_MOVIE_SCENE");
    });

};
