const { Markup } = require("telegraf");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner"); // ✅ import helper

module.exports = (bot) => {
    // Reusable handler for Groups
    async function handleManageGroups(ctx, isReload = false) {
        const userId = ctx.from.id;
        const userData = await user_setting_module.findOne({ user_id: userId });

        let buttons = [];
        let textMsg = `⚙️ <b>Manage Group Settings</b>\n\n👉 <b>Select the group</b> whose settings you want to change.`;

        if (userData && userData.groups_chat_ids?.length) {
            let changed = false;

            for (const chatId of userData.groups_chat_ids) {
                try {
                    const chatIdStr = String(chatId);

                    const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId, false);
                    if (isOwner) {
                        const chat = await ctx.telegram.getChat(chatId);
                        buttons.push([Markup.button.callback(chat.title, `GROUP_SETTINGS_${chatId}`)]);
                    } else {
                        // remove from lists
                        const beforeG = userData.groups_chat_ids.length;
                        userData.groups_chat_ids = userData.groups_chat_ids.filter(id => String(id) !== chatIdStr);

                        const beforeC = userData.channels_chat_ids?.length || 0;
                        userData.channels_chat_ids = (userData.channels_chat_ids || []).filter(id => String(id) !== chatIdStr);

                        // remove settings key (proper delete)
                        if (userData.settings && typeof userData.settings.delete === "function") {
                            const hadKey = userData.settings.has(chatIdStr);
                            userData.settings.delete(chatIdStr);
                            if (hadKey) changed = true;
                        } else {
                            // fallback (rare)
                            userData.settings = userData.settings || {};
                            if (userData.settings[chatIdStr] !== undefined) changed = true;
                            delete userData.settings[chatIdStr];
                        }

                        if (userData.groups_chat_ids.length !== beforeG) changed = true;
                        if ((userData.channels_chat_ids?.length || 0) !== beforeC) changed = true;
                    }
                } catch (err) {
                    console.log(`⚠️ Could not fetch group info for ${chatId}`, err.message);
                }
            }

            if (changed) {
                await userData.save();
            }
        }

        if (!buttons.length) {
            textMsg += `\n\n❌ <b>No groups found.</b>`;
        }

        // Back + Reload
        buttons.push([
            Markup.button.callback("⬅️ Back", "BACK_TO_HOME"),
            Markup.button.callback("🔄 Reload", "MANAGE_GROUPS_RELOAD")
        ]);

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });

        // Agar reload ke through aya hai → alert dikhao
        if (isReload) {
            await ctx.answerCbQuery("✅ Groups list successfully reloaded!");
        }
    }

    // Reusable handler for Channels
    async function handleManageChannels(ctx, isReload = false) {
        const userId = ctx.from.id;
        const userData = await user_setting_module.findOne({ user_id: userId });

        let buttons = [];
        let textMsg = `⚙️ <b>Manage Channel Settings</b>\n\n👉 <b>Select the channel</b> whose settings you want to change.`;

        if (userData && userData.channels_chat_ids.length) {
            for (const chatId of userData.channels_chat_ids) {
                try {
                    const chat = await ctx.telegram.getChat(chatId);
                    buttons.push([Markup.button.callback(chat.title, `CHANNEL_SETTINGS_${chatId}`)]);
                } catch (err) {
                    console.log(`⚠️ Could not fetch channel info for ${chatId}`, err.message);
                }
            }
        }

        if (!buttons.length) {
            textMsg += `\n\n❌ <b>No channels found.</b>`;
        }

        // Back + Reload
        buttons.push([
            Markup.button.callback("⬅️ Back", "BACK_TO_HOME"),
            Markup.button.callback("🔄 Reload", "MANAGE_CHANNELS_RELOAD")
        ]);

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });

        // Agar reload ke through aya hai → alert dikhao
        if (isReload) {
            await ctx.answerCbQuery("✅ Channels list successfully reloaded!");
        }
    }

    // ✅ Actions bind karo
    bot.action("MANAGE_GROUPS", (ctx) => handleManageGroups(ctx, false));
    bot.action("MANAGE_GROUPS_RELOAD", (ctx) => handleManageGroups(ctx, true));

    bot.action("MANAGE_CHANNELS", (ctx) => handleManageChannels(ctx, false));
    bot.action("MANAGE_CHANNELS_RELOAD", (ctx) => handleManageChannels(ctx, true));


    bot.action(/^CHANNEL_SETTINGS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            // Render the per-channel settings menu (this also validates owner)
            await renderChannelSettings(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CHANNEL_SETTINGS_ handler error:", err);
            try {
                await ctx.answerCbQuery(
                    "🚧 Channel settings are under development.\n\nThis feature is not available yet — it will be released soon.",
                    { show_alert: true }
                );
            } catch (_) { }
        }
    });
};
