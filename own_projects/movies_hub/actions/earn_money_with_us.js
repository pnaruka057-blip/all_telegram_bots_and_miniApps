const { Markup } = require("telegraf");
const users_module = require("../model/users_module");
const menu_btn_earn_money_with_us = require("../buttons/menu_btn_earn_money_with_us");
const escapeMarkdownV2 = require("../helper/escapeMarkdownV2");

// Utility functions for validation
const isValidApiLink = (url) => {
    return /^https:\/\/[^\/]+\/api\?api=[a-zA-Z0-9]{40}&url=/.test(url);
};

const isValidQuickLink = (url) => {
    return /^https:\/\/[^\/]+\/st\?api=[a-zA-Z0-9]{40}&url=/.test(url);
};

module.exports = (bot) => {
    bot.action("USER_EARN_MONEY", async (ctx) => {
        const user = await users_module.findOne({ user_id: ctx.from.id });
        if (user.link_shortner_config && user.link_shortner_config.link_shortner_api_link && user.link_shortner_config.link_shortner_quick_link) {
            return menu_btn_earn_money_with_us(ctx, false, false);
        } else {
            const text = `💸 *Earn Money with Your Telegram Group!*\n\nHere's how it works:\n\n1️⃣ Choose any *URL shortener* service.\n2️⃣ Add its *API Link*.\n3️⃣ *Add this bot* to your group.\n\n🚀 Once setup is complete:\nAs users click download links, *you earn money*!\n\n🔐 *Note:* Only for users with Telegram groups.`;
            const buttons = Markup.inlineKeyboard([
                [Markup.button.callback("✅ I Understand. Start Setup", "START_EARN_SETUP")],
            ]);
            await ctx.editMessageText(text, { parse_mode: "Markdown", ...buttons });
        }
    });

    bot.action("START_EARN_SETUP", async (ctx) => {
        ctx.session.earnStep = "get_api_link";
        ctx.session.messageId = ctx.update.callback_query.message.message_id;
        await ctx.editMessageText(`🔗 *Step 1: Send Your URL Shortener Developer API Link*\n\n\`\`\`\nhttps://example.com/api?api=YOUR_API_KEY&url=yourdestination.com\n\`\`\`\n\n📝 Please send your full Developer API Link below.`, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🔙 Back", "USER_EARN_MONEY")],
                [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
            ])
        });

        bot.on("message", async (ctx, next) => {
            const text = ctx.message.text;
            if (!ctx.session || !ctx.session.earnStep) return;

            // STEP 1: Get API Link
            if (ctx.session.earnStep === "get_api_link") {
                if (!isValidApiLink(text)) return ctx.reply("❌ Invalid API Link.");
                ctx.deleteMessage(ctx.session.messageId);
                ctx.session.userApiLink = text;
                ctx.session.earnStep = "get_quick_link";
                let message = await ctx.reply(`⚡ *Step 2: Send Your Quick Link Format*\n\n\`\`\`\nhttps://example.com/st?api=YOUR_API_KEY&url=yourdestination.com\n\`\`\``, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Back", "START_EARN_SETUP")],
                        [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                    ])
                });
                ctx.session.messageId = message.message_id;
                return;
            }

            // STEP 2: Get Quick Link
            if (ctx.session.earnStep === "get_quick_link") {
                if (!isValidQuickLink(text)) return ctx.reply("❌ Invalid Quick Link.");
                ctx.deleteMessage(ctx.session.messageId);
                delete ctx.session.messageId;
                ctx.session.userQuickLink = text;
                ctx.session.earnStep = null;

                const user = await users_module.findOne({ user_id: ctx.from.id });

                await users_module.updateOne(
                    { user_id: ctx.from.id },
                    {
                        $set: {
                            name: ctx.from.first_name,
                            username: ctx.from.username,
                            "link_shortner_config.link_shortner_api_link": ctx.session.userApiLink,
                            "link_shortner_config.link_shortner_quick_link": ctx.session.userQuickLink,
                        }
                    }
                );

                const addedAdminGroups = user.groupsLists.filter(g => g.isAdmin);
                const addedNonAdminGroups = user.groupsLists.filter(g => !g.isAdmin);

                let msg = "";
                const buttons = [];

                if (addedAdminGroups.length > 0) {
                    return menu_btn_earn_money_with_us(ctx, `🎉 *${escapeMarkdownV2("Setup Complete!")}*\n\n✅ Your earning system is now active with the following groups:\n\n${addedAdminGroups.map(g => `• ${g.groupName}`).join("\n")}\n\n💰 You will earn money as users click download links in these groups`, false);
                } else if (addedNonAdminGroups.length > 0) {
                    msg += `⚠️ *Bot is added but not admin in these groups:*\n${addedNonAdminGroups.map(g => `• ${g.groupName}`).join("\n")}`;
                    buttons.push([Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]);
                } else {
                    msg += `👥 *Please add me to your Telegram group as Admin to continue earning.*`;
                    buttons.push(
                        [Markup.button.url("➕ Add Me To Group", `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
                        [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
                    );
                }

                return ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(buttons)
                });
            }
        });
    });


    bot.on("my_chat_member", async (ctx) => {
        const update = ctx.update;
        const newStatus = update.my_chat_member.new_chat_member.status;
        const chat = update.my_chat_member.chat;
        const botId = update.my_chat_member.new_chat_member.user.id;
        const userId = ctx.update.my_chat_member.from.id;

        console.log("New Bot Status:", newStatus);

        // Bot added as admin or creator
        if ((newStatus === "administrator" || newStatus === "creator") && botId === ctx.botInfo.id) {
            const user = await users_module.findOne({ user_id: userId });

            const groupObj = {
                groupId: chat.id.toString(),
                groupName: chat.title.toString(),
                isAdmin: true
            };

            if (user) {
                const existingGroup = user.groupsLists.find(
                    (g) => g.groupId === chat.id.toString()
                );

                if (existingGroup) {
                    // Update existing group
                    await users_module.updateOne(
                        { user_id: userId, "groupsLists.groupId": chat.id.toString() },
                        {
                            $set: {
                                "groupsLists.$.groupName": chat.id.toString(),
                                "groupsLists.$.isAdmin": true
                            }
                        }
                    );
                } else {
                    // Push new group object
                    await users_module.updateOne(
                        { user_id: userId },
                        {
                            $push: { groupsLists: groupObj }
                        }
                    );
                }
            }

            const userConfig = user?.link_shortner_config;

            if (!userConfig || !userConfig?.link_shortner_api_link || !userConfig?.link_shortner_quick_link) {
                try {
                    await ctx.sendMessage(`⚠️ You've added the bot as *admin* in the group *${chat.title}*, but your earning system isn't fully setup yet.\n\n🛠️ Please complete the shortner setup first to activate the earning system.`, {
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("🚀 Complete Setup", "START_EARN_SETUP")],
                            [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
                        ])
                    });
                } catch (err) {
                    console.log("❌ Can't send setup reminder to user.");
                }
                return;
            }

            try {
                await ctx.sendMessage(`✅ Thank you for making the bot an admin in *${chat.title}* group!\n\n🔗 Your earning system is now fully set up and ready to use.`, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
                    ])
                });
            } catch (err) {
                console.log("❌ Can't send DM to user.");
            }
        }

        // Bot removed from admin (downgraded to member)
        else if (newStatus === "member") {
            const user = await users_module.findOne({ user_id: userId });

            const groupObj = {
                groupId: chat.id.toString(),
                groupName: chat.title?.toString(),
                isAdmin: false
            };

            if (user) {
                const existingGroup = user.groupsLists.find(
                    (g) => g.groupId === chat.id.toString()
                );

                if (existingGroup) {
                    // Update existing group
                    await users_module.updateOne(
                        { user_id: userId, "groupsLists.groupId": chat.id.toString() },
                        {
                            $set: {
                                "groupsLists.$.groupName": chat.title.toString(),
                                "groupsLists.$.isAdmin": false
                            }
                        }
                    );
                } else {
                    // Push new group object
                    await users_module.updateOne(
                        { user_id: userId },
                        {
                            $push: { groupsLists: groupObj }
                        }
                    );
                }
            }

            if (!user?.link_shortner_config || !user?.link_shortner_config?.link_shortner_api_link || !user?.link_shortner_config?.link_shortner_quick_link) {
                try {
                    await ctx.sendMessage(`🚫 Your earning system was not properly set up.\n\n🛠️ Please complete your earning setup before re-adding the bot.`, {
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("🚀 Complete Setup", "START_EARN_SETUP")],
                            [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
                        ])
                    });
                } catch (err) {
                    console.log("❌ Can't notify user (setup not complete, admin removed).");
                }
                return;
            }

            try {
                await ctx.sendMessage(`⚠️ The bot has been removed as admin from *${chat.title}* group.\n\n➡️ Please make the bot an *admin* in the group to resume earnings.`, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
                    ])
                });
            } catch (err) {
                console.log("❌ Can't notify user on admin removal.");
            }
        }

        // Bot removed or kicked from group
        else if (newStatus === "left" || newStatus === "kicked") {
            const user = await users_module.findOne({ user_id: userId, "groupsLists.groupId": chat.id.toString() });
            if (!user?.link_shortner_config || !user?.link_shortner_config?.link_shortner_api_link || !user?.link_shortner_config?.link_shortner_quick_link) {
                return;
            }
            try {
                await ctx.sendMessage(`❌ The bot has been removed or kicked from *${chat.title}* group.\n\n🚫 Your earning system will no longer work.\n\n➡️ Please re-add the bot to the group and make it *admin* to continue earning.`, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.url("➕ Add Again", `https://t.me/${ctx.botInfo.username}?startgroup=true`)],
                        [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
                    ])
                });
            } catch (err) {
                console.log("❌ Can't notify user on bot removal.");
            }
        }

    });
};
