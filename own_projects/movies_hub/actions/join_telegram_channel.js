const menu_btn_users = require("../buttons/menu_btn_users");

module.exports = (bot) => {
    bot.action("CHECK_JOIN_BACKUP", async (ctx) => {
        try {
            const channelUsername = `@${process.env.CHANNEL_ID_MOVIEHUB}`; // Your backup channel
            const member = await ctx.telegram.getChatMember(channelUsername, ctx.from.id);

            if (["member", "administrator", "creator"].includes(member.status)) {
                ctx.reply("✅ Thank you for joining! You're now verified and can use the bot.");
                setTimeout(() => {
                    menu_btn_users(ctx);
                }, 2000);
                try {
                    await ctx.deleteMessage();
                } catch (err) {
                    console.warn("❌ Failed to delete message:", err.description || err.message);
                }
            } else {
                ctx.reply("❌ You haven't joined the channel yet. Please join first and then click verify.");
            }
        } catch (err) {
            console.error("Backup channel join check error:", err);
            ctx.reply("⚠️ Couldn't verify join status. Please try again in a few seconds.");
        }
    });
}