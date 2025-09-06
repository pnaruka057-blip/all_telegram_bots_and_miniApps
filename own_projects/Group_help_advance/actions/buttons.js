module.exports = (bot) => {
    // Handle popup buttons
    bot.action(/POPUP_(.+)/, async (ctx) => {
        const encoded = ctx.match[1];
        const decoded = Buffer.from(encoded, "base64").toString("utf8");

        // "popup:" hatana aur escaped \n ko actual new line banana
        const content = decoded
            .replace(/^popup:/, "")
            .replace(/\\n/g, "\n");

        await ctx.answerCbQuery(content, { show_alert: true });
    });

    // Handle alert buttons
    bot.action(/ALERT_(.+)/, async (ctx) => {
        const encoded = ctx.match[1];
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        const content = decoded.replace(/^alert:/, ""); // "alert:" remove

        await ctx.answerCbQuery(content, { show_alert: false });
    });

    // Handle delete buttons
    bot.action(/DEL_(.+)/, async (ctx) => {
        // decode content (abhi hamesha "del" hi hoga, but future safe hai)
        const encoded = ctx.match[1];
        const decoded = Buffer.from(encoded, "base64").toString("utf8");

        if (decoded === "del") {
            await ctx.deleteMessage();
        } else {
            await ctx.answerCbQuery("Invalid delete action!", { show_alert: true });
        }
    });

    // Handle personal buttons
    bot.action(/PERSONAL_(.+)/, async (ctx) => {
        try {
            const encoded = ctx.match[1];
            const decodedCommand = Buffer.from(encoded, "base64").toString("utf8");
            const slashCommand = `/${decodedCommand}`; // e.g. /command2

            // Fake update proper structure ke sath
            const fakeUpdate = {
                update_id: ctx.update.update_id + 1,
                message: {
                    message_id: ctx.update.callback_query.message.message_id + 1,
                    from: ctx.from,
                    chat: ctx.chat,
                    date: Math.floor(Date.now() / 1000),
                    text: slashCommand,
                    entities: [
                        {
                            offset: 0,
                            length: slashCommand.length,
                            type: "bot_command"
                        }
                    ]
                },
            };

            // Telegraf ko pass karo
            await bot.handleUpdate(fakeUpdate);

            await ctx.answerCbQuery(`✅ Executed ${slashCommand}`);
        } catch (err) {
            console.error("PERSONAL button error:", err);
            await ctx.answerCbQuery("❌ Failed to run command", { show_alert: true });
        }
    });

    // Generic fallback
    bot.action(/GENERIC_(.+)_(.+)/, async (ctx) => {
        const btnText = ctx.match[1];
        await ctx.answerCbQuery(`🔘 Generic button: ${btnText}`);
    });
}