// replace your existing handler with this improved version

const menu_btn_users = require("../buttons/menu_btn_users");

module.exports = (bot) => {
    bot.action("CHECK_JOIN_BACKUP", async (ctx) => {
        try {
            // acknowledge callback (prevents "buttons spinning")
            try { await ctx.answerCbQuery(); } catch (e) { /* ignore */ }

            const rawChannel = process.env.CHANNEL_ID_MOVIEHUB || "";
            // allow env to contain either "username" or "@username"
            const channelUsername = rawChannel.startsWith("@") ? rawChannel : `@${rawChannel}`;

            let member;
            try {
                member = await ctx.telegram.getChatMember(channelUsername, ctx.from.id);
            } catch (err) {
                // normalize description
                const desc = (err && (err.description || err.response?.description || "")).toString();

                console.warn("getChatMember failed:", err && (err.description || err.message || err));

                // Specific handling for missing admin permissions
                if (desc.includes("CHAT_ADMIN_REQUIRED")) {
                    // Inform the user/admin what to do next
                    return ctx.reply(
                        `Unable to verify membership because the bot lacks permission to read channel members for ${channelUsername}.\n\n` +
                        `Solution:\n` +
                        `1) Open the channel ${channelUsername} as its owner/admin.\n` +
                        `2) Add the bot (@${ctx.botInfo.username}) as an *administrator* in that channel.\n` +
                        `   - You don't need to give every permission; but the bot must be an admin so it can check membership.\n` +
                        `3) After making the bot admin, ask the user to click "Verify" again.\n\n` +
                        `Tip: If you intentionally don't want the bot as admin, you cannot reliably check joins via the bot for private channels.`
                    );
                }

                // If channel not found or user privacy or other known Telegram errors:
                if (desc.includes("CHAT_NOT_FOUND") || desc.includes("USER_NOT_PARTICIPANT") || desc.includes("USER_ID_INVALID")) {
                    return ctx.reply("Couldn't verify join status: channel or user not found. Please check channel config and try again.");
                }

                // fallback generic message
                return ctx.reply("Couldn't verify join status due to Telegram API error: " + (err.description || err.message || "unknown error"));
            }

            // If we have a valid member object
            if (member && ["member", "administrator", "creator"].includes(member.status)) {
                await ctx.reply("✅ Thank you for joining! You're now verified and can use the bot.");
                // call menu after short delay (you can remove setTimeout if you prefer)
                setTimeout(() => { menu_btn_users(ctx); }, 1500);
                try { await ctx.deleteMessage(); } catch (err) { console.warn("Failed to delete message:", err && (err.message || err)); }
            } else {
                await ctx.reply("❌ You haven't joined the channel yet. Please join first and then click verify.");
            }

        } catch (err) {
            console.error("Backup channel join check error:", err);
            try { await ctx.reply("⚠️ Couldn't verify join status. Please try again in a few seconds."); } catch (_) { }
        }
    });
};