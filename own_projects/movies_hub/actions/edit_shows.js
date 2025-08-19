const shows_module = require("../model/shows_module");

module.exports = (bot) => {
    // Action to enter show editing wizard
    bot.action("EDIT_SHOW_ADMIN_PANEL", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            await ctx.deleteMessage();
            await ctx.scene.enter("EDIT_SHOW_SCENE");
        } catch (err) {
            console.error("❌ Error:", err);
            await ctx.reply("❌ Something went wrong!");
        }
    });

    bot.action(/^EDIT_THIS_SHOW_(.+)$/, async (ctx) => {
        const showId = ctx.match[1];
        const show = await shows_module.findById(showId).lean();
        if (!show) return ctx.reply("Show not found!");

        ctx.session.showId = showId;
        ctx.session.editMessageId = ctx.update.callback_query.message.message_id;

        // Save show data to session to prefill later in UPDATE_SHOW_SCENE
        ctx.scene.enter("UPDATE_SHOW_SCENE");
    });

    // EDIT existing season
    bot.action(/EDIT_SEASON_(\d+)/, async (ctx) => {
        const seasonIndex = parseInt(ctx.match[1]);
        ctx.wizard.state.currentSeason = ctx.wizard.state.showData.series[seasonIndex];

        await ctx.answerCbQuery(); // acknowledge

        await ctx.editMessageText(`🔗 Enter *Download Links* for Season ${seasonIndex + 1}:`, {
            parse_mode: "Markdown",
            reply_markup: { remove_keyboard: true }
        });

        return ctx.wizard.selectStep(6); // jump to Download Links step
    });

    // ADD new season
    bot.action("ADD_NEW_SEASON", async (ctx) => {
        ctx.wizard.state.currentSeason = {};
        await ctx.answerCbQuery();

        await ctx.editMessageText("🔗 Enter *Download Links* for this season (one per line):", {
            parse_mode: "Markdown",
            reply_markup: { remove_keyboard: true }
        });

        return ctx.wizard.selectStep(6);
    });

};
