const user_setting_module = require("../models/user_settings_module");

/**
 * Works for:
 * - my_chat_member (when bot is promoted)
 * - /start@BotUsername (manual trigger in group)
 */
module.exports = async (ctx) => {
    try {
        let chat, actor, newStatus;

        // Case 1: my_chat_member update
        if (ctx.update.my_chat_member) {
            chat = ctx.chat;
            actor = ctx.from;
            newStatus = ctx.update.my_chat_member.new_chat_member.status;

            // Only proceed when bot became administrator
            if (newStatus !== "administrator") return;
        }

        // Case 2: /start@BotUsername in group
        else if (ctx.update.message) {
            chat = ctx.chat;
            actor = ctx.from;
            newStatus = "administrator"; // treat as forced trigger
        }

        const userId = actor.id;
        const chatId = chat.id;
        const chatIdStr = String(chatId);
        const chatType = chat.type; // "group" | "supergroup" | "channel"

        // 1) Verify the actor is the owner/creator of this chat
        let memberInfo;
        try {
            memberInfo = await ctx.telegram.getChatMember(chatId, userId);
        } catch (err) {
            console.error("Error fetching chat member info:", err);
            return;
        }

        if (!memberInfo || memberInfo.status !== "creator") {
            try {
                await ctx.telegram.sendMessage(
                    userId,
                    `⚠️ Sorry — you are not the *owner* of "${chat.title || chatId}".\n\nOnly the chat *owner* (creator) can register this group/channel with the bot.`,
                    { parse_mode: "Markdown" }
                );
            } catch (err) {
                console.log("Could not send DM to user (owner-check fail).");
            }
            return;
        }

        // 2) Remove this chatId from any other user's documents
        const isGroup = chatType === "group" || chatType === "supergroup";
        const arrayField = isGroup ? "groups_chat_ids" : "channels_chat_ids";
        const settingsPath = `settings.${chatIdStr}`;

        try {
            await user_setting_module.updateMany(
                { [arrayField]: chatIdStr, user_id: { $ne: userId } },
                { $pull: { [arrayField]: chatIdStr }, $unset: { [settingsPath]: "" } }
            );
        } catch (err) {
            console.error("Error removing chatId from other users:", err);
        }

        // 3) Add chatId to current owner's document
        const defaultSettings = { enabled: true };
        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $addToSet: { [arrayField]: chatIdStr },
                    $set: { [settingsPath]: defaultSettings },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        } catch (err) {
            console.error("Error updating owner's document:", err);
        }

        // 4) Confirmation DM
        try {
            await ctx.telegram.sendMessage(
                userId,
                `✅ Success! I am now registered in *${chat.title || chatId}* (${chatType}).\n\nThis chat is now linked to you as the owner.`,
                { parse_mode: "Markdown" }
            );
        } catch {
            console.log("⚠️ Could not send confirmation DM (maybe /start not done).");
        }

        console.log(`Registered chat ${chatIdStr} (${chatType}) to user ${userId} as owner`);
    } catch (err) {
        console.error("❌ Error in check_then_transfer_group_or_channel:", err);
    }
};
