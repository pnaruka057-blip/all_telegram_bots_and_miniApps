const { Markup } = require("telegraf");
const shows_module = require("../model/shows_module");
const users_module = require("../model/users_module");
const menu_btn_users = require("../buttons/menu_btn_users");

module.exports = (bot) => {
    bot.action("FIND_SHOWS", async (ctx) => {
        try {
            const message = `🎬 *Find Any Show*\n\nSend the name of the show you want to download. We'll try to find it for you. Everything here is *fully free*, no paid content at all.\n\n_Type the show name below:_`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("🏠 Main Menu", "MAIN_MENU")]
            ]);

            try {
                ctx.session.awaitingShowSearch = true;
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
                if (ctx.session.awaitingShowSearch) {
                    ctx.session.awaitingShowSearch = false;
                    try {
                        const query = ctx.message.text;
                        const user = await users_module.findOne({ user_id: ctx.from.id });

                        const userMessageId = ctx.message.message_id;

                        // Schedule deletion of user search message after 5 minutes
                        setTimeout(() => {
                            ctx.telegram.deleteMessage(ctx.chat.id, userMessageId).catch(() => { });
                        }, 5 * 60 * 1000);

                        const results = await shows_module.find({
                            title: { $regex: query, $options: "i" }
                        });

                        const langRegex = new RegExp(`\\b${user.language}\\b`, "i");

                        const matchingByLang = results.filter(show => langRegex.test(show.language));
                        const otherLangMatches = results.filter(show => !langRegex.test(show.language));

                        if (matchingByLang.length > 0) {
                            for (let show of matchingByLang) {
                                const downloadButtons = [];
                                show.series.forEach((_, index) => {
                                    downloadButtons.push(Markup.button.callback(`S${index + 1}`, `SELECTED_SEASON_${show._id}_${index}`));
                                });

                                const extraButtons = [
                                    [Markup.button.callback("🔍 Find Again", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                                    [Markup.button.callback("🎯 Go Ad-Free Mode", "REMOVE_ADS")],
                                ];

                                const sentMsg = await ctx.replyWithPhoto(show.thumbnail, {
                                    caption: `
╭───────────────❒
⫸ 🎬 *Show Title:* ${show.title}
⫸ 📅 *Release Date:* ${show.release_date}
⫸ 🈳 *Language:* ${show.language}
⫸ 🎭 *Genre:* ${show.genre}
⫸ 📚 *Total Seasons:* ${show.series.length}
⫸ 📥 *Downloads:* ${show.download_count}
╰───────────────❒

> ⚠️ *This message will auto-delete after 5 minutes to avoid copyright issues.*`,
                                    parse_mode: "Markdown",
                                    ...Markup.inlineKeyboard([downloadButtons, ...extraButtons])
                                });

                                ctx.session._prev_messageId = sentMsg.message_id;

                                setTimeout(() => {
                                    ctx.telegram.deleteMessage(sentMsg.chat.id, sentMsg.message_id).catch(() => { });
                                }, 5 * 60 * 1000);
                            }
                        } else if (otherLangMatches.length > 0) {
                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.callback("🔎 Show Matching Shows", "CONTINUE_DOWNLOADING_SHOWS")],
                                [Markup.button.callback("🔙 Back", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            ]);

                            await ctx.reply(
                                `📢 I found some shows matching *${query}*, but they are not available in your selected language (*${user.language}*).\n\nWould you like to see those results in other languages?`,
                                { parse_mode: "Markdown", ...keyboard }
                            );
                        } else {
                            const keyboard = Markup.inlineKeyboard([
                                [Markup.button.callback("🎬 Request This Show", `SEND_SHOW_REQUEST_ANY_${query}`)],
                                [Markup.button.callback("🔙 Back", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
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

                    } catch (err) {
                        console.error("Error while searching show:", err);
                    } finally {
                        await next();
                    }
                } else {
                    await next();
                }
            });

            bot.action(/^SELECTED_SEASON_(.+)$/, async (ctx) => {
                if (ctx.session._prev_messageId) {
                    ctx.telegram.deleteMessage(ctx.chat.id, ctx.session._prev_messageId).catch(() => { });
                    delete ctx.session._prev_messageId;
                }
                const matchingData = ctx.match[1];
                const [showId, seasonIndex] = matchingData.split("_");
                const show = await shows_module.findById(showId).lean();
                const downloadButtons = [];
                show?.series[seasonIndex]?.download_link?.forEach((link, index) => {
                    downloadButtons.push(Markup.button.url(`🚀 ${show.series[seasonIndex].quality[index]}`, link));
                });

                const extraButtons = [
                    [Markup.button.callback("🔍 Find Again", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                    [Markup.button.callback("🎯 Go Ad-Free Mode", "REMOVE_ADS")],
                ];

                const sentMsg = await ctx.replyWithPhoto(show.thumbnail, {
                    caption: `
╭───────────────❒
⫸ 🎬 *Show Title:* ${show.title}
⫸ 📅 *Release Date:* ${show.release_date}
⫸ 🈳 *Language:* ${show.language}
⫸ 🎭 *Genre:* ${show.genre}
⫸ 📚 *Total Seasons:* ${show.series.length}
⫸ 📥 *Downloads:* ${show.download_count}
╰───────────────❒

> ⚠️ *This message will auto-delete after 5 minutes to avoid copyright issues.*

Currently You Seleted ${Number(seasonIndex) + 1} Season`,
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([downloadButtons, ...extraButtons])
                });

                setTimeout(() => {
                    ctx.telegram.deleteMessage(sentMsg.chat.id, sentMsg.message_id).catch(() => { });
                }, 5 * 60 * 1000);
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

            bot.action('CONTINUE_DOWNLOADING_SHOWS', async (ctx) => {
                try {
                    ctx.deleteMessage().catch(() => { });

                    const query = ctx.session && ctx.session.lastQuery ? ctx.session.lastQuery : "";
                    const user = await users_module.findOne({ user_id: ctx.from.id });

                    const results = await shows_module.find({
                        title: { $regex: query, $options: "i" }
                    });

                    const langRegex = new RegExp(`\\b${user.language}\\b`, "i");
                    const otherLangMatches = results.filter(movie => !langRegex.test(movie.language));

                    for (let show of otherLangMatches) {
                        const downloadButtons = [];
                        show.series.forEach((_, index) => {
                            downloadButtons.push(Markup.button.callback(`S${index + 1}`, `SELECTED_SEASON_${show._id}_${index}`));
                        });

                        const extraButtons = [
                            [Markup.button.callback("🔍 Find Again", "FIND_SHOWS"), Markup.button.callback("🏠 Main Menu", "MAIN_MENU")],
                            [Markup.button.callback("🎯 Go Ad-Free Mode", "REMOVE_ADS")],
                        ];

                        const sentMsg = await ctx.replyWithPhoto(show.thumbnail, {
                            caption: `
╭───────────────❒
⫸ 🎬 *Show Title:* ${show.title}
⫸ 📅 *Release Date:* ${show.release_date}
⫸ 🈳 *Language:* ${show.language}
⫸ 🎭 *Genre:* ${show.genre}
⫸ 📚 *Total Seasons:* ${show.series.length}
⫸ 📥 *Downloads:* ${show.download_count}
╰───────────────❒

> ⚠️ *This message will auto-delete after 5 minutes to avoid copyright issues.*`,
                            parse_mode: "Markdown",
                            ...Markup.inlineKeyboard([downloadButtons, ...extraButtons])
                        });

                        ctx.session._prev_messageId = sentMsg.message_id;

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

    bot.action('MAIN_MENU', async (ctx) => {
        try {
            await menu_btn_users(ctx);
        } catch (err) {
            console.error("Error in MAIN_MENU action:", err);
            await ctx.reply("⚠️ An error occurred while navigating to the main menu.");
        }
    });
};
