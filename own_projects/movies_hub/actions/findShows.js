const { Markup } = require("telegraf");
const shows_module = require("../model/shows_module");
const users_module = require("../model/users_module");
const menu_btn_users = require("../buttons/menu_btn_users");
const mini_app_link = process.env.GLOBLE_DOMAIN
const movies_hub_token = process.env.MOVIES_HUB_TOKEN
const redis = require("../../../globle_helper/redisConfig");

// ✅ Helper: save message to Redis with expiry
async function saveMessage(chatId, messageId) {
    const key = `find_shows:${chatId}`;
    const data = await redis.get(key);
    let arr = [];
    if (data) {
        try {
            arr = JSON.parse(data);
        } catch {
            arr = [];
        }
    }
    arr.push({
        chatId,
        messageId,
        expireAt: Date.now() + 3 * 60 * 1000 // 3 minutes
    });
    await redis.set(key, JSON.stringify(arr));
}

module.exports = (bot) => {
    bot.action("FIND_SHOWS", async (ctx) => {
        try {
            const message = `🎬 *Find Any Show*\n\nSend the name of the show you want to download. We'll try to find it for you. Everything here is *fully free*, no paid content at all.\n\n_Type the show name below:_`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
            ]);

            try {
                ctx.session.awaitingShowSearch = true;
                const sentMsg = await ctx.editMessageText(message, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
                await saveMessage(ctx.chat.id, sentMsg.message_id);
            } catch (e) {
                const sentMsg = await ctx.reply(message, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
                await saveMessage(ctx.chat.id, sentMsg.message_id);
            }

            ctx.session.messageId = ctx.update.callback_query.message.message_id;

            bot.on("text", async (ctx, next) => {
                if (ctx.session.awaitingShowSearch) {
                    ctx.session.awaitingShowSearch = false;
                    try {
                        const query = ctx.message.text;
                        const user = await users_module.findOne({ user_id: ctx.from.id });

                        const userMessageId = ctx.message.message_id;
                        await saveMessage(ctx.chat.id, userMessageId);

                        const results = await shows_module.find({
                            title: { $regex: query, $options: "i" }
                        });

                        const langRegex = new RegExp(`\\b${user.language}\\b`, "i");

                        const matchingByLang = results.filter(show => langRegex.test(show.language));
                        const otherLangMatches = results.filter(show => !langRegex.test(show.language));

                        if (matchingByLang.length > 0) {
                            const miniAppUrlShows = `${mini_app_link}/${movies_hub_token}/movies-hub/find-shows/${encodeURIComponent(query)}?user_id=${ctx.from.id}&fromId=${ctx.from.id}`;

                            let sendMsg = await ctx.reply(
                                `📺 *Show Found!* 🎬\n\n✨ You searched for: *${query}*\n\n🌐 Matched with your language preference ✅\n\n🎯 Total Matches Found: *${matchingByLang.length}*\n\n⚡ Tap below to continue the process and start download`,
                                {
                                    parse_mode: "Markdown",
                                    ...Markup.inlineKeyboard([
                                        [Markup.button.webApp("📥 Continue to Download", miniAppUrlShows)]
                                    ])
                                }
                            );

                            // save for cron cleanup
                            await saveMessage(ctx.chat.id, sendMsg.message_id);
                        } else if (otherLangMatches.length > 0) {
                            const miniAppUrlShows = `${mini_app_link}/${movies_hub_token}/movies-hub/find-shows/${encodeURIComponent(query)}?user_id=${ctx.from.id}&fromId=${ctx.from.id}`;
                            const miniAppUrlRequestShows = `${mini_app_link}/${movies_hub_token}/movies-hub/send-request/${encodeURIComponent(query)}?show=true&user_id=${ctx.from.id}`;

                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.webApp("🔎 Show Matching Shows", miniAppUrlShows)],
                                [Markup.button.webApp("📺 Request Show in My Language", miniAppUrlRequestShows)],
                                [Markup.button.callback("🔙 Back", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            ]);

                            const sentMsg = await ctx.reply(
                                `📢 I found *${otherLangMatches.length}* shows matching *${query}*, but they are not available in your selected language (*${user.language}*).\n\nYou can either view these shows in other languages or request it in your language using the buttons below:`,
                                { parse_mode: "Markdown", ...keyboard }
                            );

                            // save for cron cleanup
                            await saveMessage(ctx.chat.id, sentMsg.message_id);
                        } else {
                            const miniAppUrlShows = `${mini_app_link}/${movies_hub_token}/movies-hub/send-request/${encodeURIComponent(query)}?show=true&user_id=${ctx.from.id}`;

                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.webApp("📺 Request This Show", miniAppUrlShows)],
                                [Markup.button.callback("🔙 Back", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            ]);

                            const sentMsg = await ctx.reply(
                                `❌ Sorry, no results found for *${query}*.\n\nYou can send a request via the button below and we’ll try to add it soon.`,
                                { parse_mode: "Markdown", ...keyboard }
                            );

                            // save for cron cleanup
                            await saveMessage(ctx.chat.id, sentMsg.message_id);
                        }

                        if (ctx.session.messageId) {
                            ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.messageId).catch(() => { });
                            delete ctx.session.messageId;
                        }

                        ctx.session.lastQuery = query;

                    } catch (err) {
                        console.error("Error while searching show:", err);
                    } finally {
                        await next();
                    }
                } else {
                    await next();
                }
            });
        } catch (err) {
            console.error("Error in FIND_SHOWS action:", err);
            await ctx.reply("⚠️ An error occurred while processing your request.");
        }
    });

    bot.action('MAIN_MENU', async (ctx) => {
        try {
            await menu_btn_users(ctx);
        } catch (err) {
            console.error("Error in MAIN_MENU action:", err);
            await ctx.reply("⚠️ An error occurred while navigating to the main menu.");
        }
    });
};
