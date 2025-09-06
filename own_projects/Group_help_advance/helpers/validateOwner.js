// validateOwner.js
const { Markup } = require("telegraf");
const safeEditOrSend = require("./safeEditOrSend");
const user_setting_module = require("../models/user_settings_module");

module.exports = async function validateOwner(ctx, chatId, chatIdStr, userId) {
    // 1) Fetch chat info
    let chat;
    try {
        chat = await ctx.telegram.getChat(chatId);
    } catch (err) {
        console.error("Could not fetch chat info:", err.message || err);
        await safeEditOrSend(
            ctx,
            `⚠️ Could not fetch chat info for this id (${chatIdStr}).`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "BACK_TO_HOME")]])
            }
        );
        return null;
    }

    // 2) Verify member info
    let memberInfo;
    try {
        memberInfo = await ctx.telegram.getChatMember(chatId, userId);
    } catch (err) {
        console.error("Error fetching chat member info:", err.message || err);
        await safeEditOrSend(
            ctx,
            `⚠️ Couldn't verify your role in <b>${chat.title || chatIdStr}</b>.`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "BACK_TO_HOME")]])
            }
        );
        return null;
    }

    // 3) Ownership check
    const isGroup = chat.type === "group" || chat.type === "supergroup";
    const isChannel = chat.type === "channel";
    let isOwner = false;

    if (isGroup) {
        isOwner = memberInfo?.status === "creator";
    } else if (isChannel) {
        isOwner = memberInfo?.status === "creator";
    }

    if (!isOwner) {
        await ctx.answerCbQuery("Only the chat owner can manage settings.", { show_alert: false });
        await safeEditOrSend(
            ctx,
            `⚠️ You are not the <b>owner</b> of <i>${chat.title || chatIdStr}</i>.\n\nOnly the chat owner (creator) can register and manage this chat with the bot.`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "BACK_TO_HOME")]])
            }
        );
        return null;
    }

    // 4) DB ownership transfer (ONLY if already exists for another user)
    const arrayField = isGroup ? "groups_chat_ids" : "channels_chat_ids";

    // check if already owned by someone else
    const previousDoc = await user_setting_module.findOne({
        user_id: { $ne: userId },
        $or: [
            { [arrayField]: chatIdStr },
            { [`settings.${chatIdStr}`]: { $exists: true } }
        ]
    }).lean();

    if (previousDoc) {
        const prevSettingsObj =
            previousDoc.settings && previousDoc.settings[chatIdStr]
                ? previousDoc.settings[chatIdStr]
                : { enabled: true, createdAt: new Date() };

        const unsetObj = {};
        unsetObj[`settings.${chatIdStr}`] = "";

        try {
            // remove from all other users
            await user_setting_module.updateMany(
                { user_id: { $ne: userId }, [arrayField]: chatIdStr },
                { $pull: { [arrayField]: chatIdStr }, $unset: unsetObj }
            );
            await user_setting_module.updateMany(
                { user_id: { $ne: userId }, [`settings.${chatIdStr}`]: { $exists: true } },
                { $unset: unsetObj }
            );

            // assign to current owner
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $addToSet: { [arrayField]: chatIdStr },
                    $set: { [`settings.${chatIdStr}`]: prevSettingsObj }
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        } catch (err) {
            console.error("Error transferring ownership in DB:", err);
        }
    }

    return chat;
};
