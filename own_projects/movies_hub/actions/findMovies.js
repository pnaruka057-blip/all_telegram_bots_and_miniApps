const { Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const users_module = require("../model/users_module");
const redis_save_message_id = require('../helper/redis_save_message_id')
const redis_delete_message_id = require('../helper/redis_delete_message_id')

module.exports = (bot) => {
    bot.action("FIND_MOVIES", async (ctx) => {
        try {
            const message = `🎬 *Find Any Movie*\n\nSend the name of the movie you want to download. We'll try to find it for you. Everything here is *fully free*, no paid content at all.\n\n_Type the movie name below:_`;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
            ]);

            try {
                ctx.session.awaitingMovieSearch = true;
                await ctx.editMessageText(message, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
            } catch (e) {
                await ctx.reply(message, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
            }

            ctx.session.messageId = ctx.update.callback_query.message.message_id;

            bot.on("text", async (ctx, next) => {
                await redis_save_message_id(ctx.message.message_id)
                if (ctx.session.awaitingMovieSearch) {
                    ctx.session.awaitingMovieSearch = false;

                    try {
                        const query = ctx.message.text;
                        const user = await users_module.findOne({ user_id: ctx.from.id });

                        const userMessageId = ctx.message.message_id;

                        // Schedule deletion of user search message after 5 minutes
                        setTimeout(() => {
                            ctx.telegram.deleteMessage(ctx.chat.id, userMessageId).catch(() => { });
                        }, 5 * 60 * 1000);
                      
                        const results = await movies_module.find({
                            title: { $regex: query, $options: "i" }
                        });

                        const langRegex = new RegExp(`\\b${user.language}\\b`, "i");

                        const matchingByLang = results.filter(movie => langRegex.test(movie.language));
                        const otherLangMatches = results.filter(movie => !langRegex.test(movie.language));

                        if (matchingByLang.length > 0) {
                            for (let movie of matchingByLang) {
                                const downloadButtons = []
                                movie.download_link.forEach((link, index) =>
                                    downloadButtons.push(Markup.button.url(`🚀 ${movie.quality[index]}`, link))
                                );

                                const extraButtons = [
                                    [Markup.button.callback("🔍 Find Again", "FIND_MOVIES"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                                    [Markup.button.callback("🎯 Go Ad-Free Mode", "REMOVE_ADS")],
                                ];

                                const sentMsg = await ctx.replyWithPhoto(movie.thumbnail, {
                                    caption: `
╭───────────────❒
⫸ 🎬 *Movie Title:* ${movie.title}
⫸ 📅 *Release Date:* ${movie.release_date}
⫸ 🈳 *Language:* ${movie.language}
⫸ 🎭 *Genre:* ${movie.genre}
⫸ 📥 *Downloads:* ${movie.download_count}
╰───────────────❒

> ⚠️ *This message will auto-delete after 5 minutes to avoid copyright issues.*`,
                                    parse_mode: "Markdown",
                                    ...Markup.inlineKeyboard([downloadButtons, ...extraButtons])
                                });

                                setTimeout(() => {
                                    ctx.telegram.deleteMessage(sentMsg.chat.id, sentMsg.message_id).catch(() => { });
                                }, 5 * 60 * 1000);
                            }
                        } else if (otherLangMatches.length > 0) {
                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.callback("🔎 Show Matching Movies", "CONTINUE_DOWNLOADING_MOVIE")],
                                [Markup.button.callback("🔙 Back", "FIND_MOVIES"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            ]);

                            await ctx.reply(
                                `📢 I found some movies matching *${query}*, but they are not available in your selected language (*${user.language}*).\n\nWould you like to see those results in other languages?`,
                                { parse_mode: "Markdown", ...keyboard }
                            );
                        } else {
                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.callback("🎬 Request This Movie", `SEND_MOVIE_REQUEST_ANY_${query}`)],
                                [Markup.button.callback("🔙 Back", "FIND_MOVIES"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            ]);

                            await ctx.reply(
                                `❌ Sorry, no results found for *${query}*.\n\nYou can send a request and we’ll try to add it soon.`,
                                { parse_mode: "Markdown", ...keyboard }
                            );
                        }

                        if (ctx.session.messageId) {
                            ctx.telegram.deleteMessage(ctx.chat.id, ctx.session.messageId).catch(() => { });
                            delete ctx.session.messageId;
                        }

                        // Save query for reuse
                        ctx.session.lastQuery = query;
                        await redis_delete_message_id(ctx)
                    } catch (err) {
                        console.error("Error while searching movie:", err);
                    } finally {
                        await next();
                    }
                } else {
                    await next();
                }
            });

            bot.action('CONTINUE_DOWNLOADING_MOVIE', async (ctx) => {
                try {
                    ctx.deleteMessage().catch(() => { });

                    const user = await users_module.findOne({ user_id: ctx.from.id });
                    const query = ctx.session && ctx.session.lastQuery ? ctx.session.lastQuery : "";
                    const results = await movies_module.find({
                        title: { $regex: query, $options: "i" }
                    });
                    const langRegex = new RegExp(`\\b${user.language}\\b`, "i");
                    const otherLangMatches = results.filter(movie => !langRegex.test(movie.language));

                    for (let movie of otherLangMatches) {
                        const downloadButtons = []
                        movie.download_link.forEach((link, index) =>
                            downloadButtons.push(Markup.button.url(`🚀 ${movie.quality[index]}`, link))
                        );

                        const extraButtons = [
                            [Markup.button.callback("🔍 Find Again", "FIND_MOVIES"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            [Markup.button.callback("🎯 Go Ad-Free Mode", "REMOVE_ADS")],
                        ];

                        const sentMsg = await ctx.replyWithPhoto(movie.thumbnail, {
                            caption: `
╭───────────────❒
⫸ 🎬 *Movie Title:* ${movie.title}
⫸ 📅 *Release Date:* ${movie.release_date}
⫸ 🈳 *Language:* ${movie.language}
⫸ 🎭 *Genre:* ${movie.genre}
⫸ 📥 *Downloads:* ${movie.download_count}
╰───────────────❒

> ⚠️ *This message will auto-delete after 5 minutes to avoid copyright issues.*`,
                            parse_mode: "Markdown",
                            ...Markup.inlineKeyboard([downloadButtons, ...extraButtons])
                        });

                        setTimeout(() => {
                            ctx.telegram.deleteMessage(sentMsg.chat.id, sentMsg.message_id).catch(() => { });
                        }, 5 * 60 * 1000);
                    }
                } catch (err) {
                    console.error("Error in CONTINUE_DOWNLOADING_MOVIE action:", err);
                }
            });
        } catch (err) {
            console.error("Error in FIND_MOVIES action:", err);
            await ctx.reply("⚠️ An error occurred while processing your request.");
        }
    });
};
