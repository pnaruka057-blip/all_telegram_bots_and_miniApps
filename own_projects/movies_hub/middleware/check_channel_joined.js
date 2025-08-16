module.exports = (action_handler, Markup) => {
    action_handler.use(async (ctx, next) => {
        const channelUsername = `@${process.env.CHANNEL_ID_MOVIEHUB}`;
        const member = await ctx.telegram.getChatMember(channelUsername, ctx.from.id);

        if (["member", "administrator", "creator"].includes(member.status)) {
            await next();
        } else {
            ctx.reply("❌ You haven't joined the channel yet. Please join first and then use the bot.", {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.url("📢 Join Backup Channel", `https://t.me/${process.env.CHANNEL_ID_MOVIEHUB}`)],
                    [Markup.button.callback("✅ I've Joined", "CHECK_JOIN_BACKUP")]
                ])
            });
        }
    });
}
