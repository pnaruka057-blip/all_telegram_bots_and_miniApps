const { Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const users_module = require("../model/users_module");
const mini_app_link = process.env.GLOBLE_DOMAIN
const movies_hub_token = process.env.MOVIES_HUB_TOKEN
const redis = require("../../../globle_helper/redisConfig");

// Helper: save message to Redis with expiry (5 minutes)
async function saveMessage(chatId, messageId) {
    const key = `find_movies:${chatId}`;
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
        expireAt: Date.now() + 3 * 60 * 1000 // 5 minutes
    });

    await redis.set(key, JSON.stringify(arr));
}

module.exports = (bot) => {
    bot.action("FIND_MOVIES", async (ctx) => {
        try {
            const message = `🎬 *Find Any Movie*\n\nSend the name of the movie you want to download. We'll try to find it for you. Everything here is *fully free*, no paid content at all.\n\n_Type the movie name below:_`;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
            ]);

            try {
                ctx.session.awaitingMovieSearch = true;
                const edited = await ctx.editMessageText(message, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
                // save bot's edited message for auto-delete
                await saveMessage(ctx.chat.id, edited.message_id);
            } catch (e) {
                const sent = await ctx.reply(message, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
                await saveMessage(ctx.chat.id, sent.message_id);
            }

            ctx.session.messageId = ctx.update.callback_query.message.message_id;

            bot.on("text", async (ctx, next) => {
                if (ctx.session.awaitingMovieSearch) {
                    ctx.session.awaitingMovieSearch = false;
                    try {
                        const query = ctx.message.text;
                        const user = await users_module.findOne({ user_id: ctx.from.id });

                        const userMessageId = ctx.message.message_id;

                        // keep your setTimeout delete (left intact)...
                        setTimeout(() => {
                            ctx.telegram.deleteMessage(ctx.chat.id, userMessageId).catch(() => { });
                        }, 5 * 60 * 1000);

                        // and ALSO save to Redis so cron can handle deletion if needed
                        await saveMessage(ctx.chat.id, userMessageId);

                        const results = await movies_module.find({
                            title: { $regex: query, $options: "i" }
                        });

                        const langRegex = new RegExp(`\\b${user.language}\\b`, "i");

                        const matchingByLang = results.filter(movie => langRegex.test(movie.language));
                        const otherLangMatches = results.filter(movie => !langRegex.test(movie.language));

                        if (matchingByLang.length > 0) {
                            const miniAppUrl = `${mini_app_link}/${movies_hub_token}/movies-hub/find-movies/${encodeURIComponent(query)}`;
                            let sendMsg = await ctx.reply(
                                `🍿 *Movie Found!* 🎬\n\n✨ You searched for: *${query}*\n\n🌐 Matched with your language preference ✅\n\n🎯 Total Matches Found: *${matchingByLang.length}*\n\n⚡ Tap below to continue the process and start download`,
                                {
                                    parse_mode: "Markdown",
                                    ...Markup.inlineKeyboard([
                                        [Markup.button.webApp("📥 Continue to Download", miniAppUrl)]
                                    ])
                                }
                            );

                            // save for cron cleanup
                            await saveMessage(ctx.chat.id, sendMsg.message_id);
                        } else if (otherLangMatches.length > 0) {
                            const miniAppUrlMovies = `${mini_app_link}/${movies_hub_token}/find-movies/${encodeURIComponent(query)}`;
                            const miniAppUrlRequest = `${mini_app_link}/${movies_hub_token}/send-request/${encodeURIComponent(query)}?movie=true`;

                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.webApp("🔎 Show Matching Movies", miniAppUrlMovies)],
                                [Markup.button.webApp("🎬 Request Movie in My Language", miniAppUrlRequest)],
                                [Markup.button.callback("🔙 Back", "FIND_MOVIES"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            ]);

                            const sentMsg = await ctx.reply(
                                `📢 I found *${otherLangMatches.length}* movies matching *${query}*, but they are not available in your selected language (*${user.language}*).\n\nYou can either view these movies in other languages or request it in your language using the buttons below:`,
                                { parse_mode: "Markdown", ...keyboard }
                            );

                            // save for cron cleanup
                            await saveMessage(ctx.chat.id, sentMsg.message_id);
                        } else {
                            const miniAppUrl = `${mini_app_link}/${movies_hub_token}/send-request/${encodeURIComponent(query)}?movie=true&user_id=${ctx.from.id}`;

                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.webApp("🎬 Request This Movie", miniAppUrl)],
                                [Markup.button.callback("🔙 Back", "FIND_MOVIES"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
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

                        // Save query for reuse
                        ctx.session.lastQuery = query;

                    } catch (err) {
                        console.error("Error while searching movie:", err);
                    } finally {
                        await next();
                    }
                } else {
                    await next();
                }
            });
        } catch (err) {
            console.error("Error in FIND_MOVIES action:", err);
            await ctx.reply("⚠️ An error occurred while processing your request.");
        }
    });
};

