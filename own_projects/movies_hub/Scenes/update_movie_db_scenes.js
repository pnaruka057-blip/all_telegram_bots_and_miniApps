const { Scenes, Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helper/cancelWizard");
const scense_stepBack = require("../helper/scense_stepBack");

const BACK = "⬅ Back";
const SKIP = "⏭ Skip";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, SKIP, CANCEL]]).resize();

const updateMovieWizard = new Scenes.WizardScene(
    "UPDATE_MOVIE_SCENE",

    // Step 0: Title
    async (ctx) => {
        let movieData = await movies_module.findById(ctx.session.movieId)
        ctx.wizard.state.movieData = movieData;
        let message = await ctx.reply("🎬 Please enter the *Movie Title*:", {
            parse_mode: "Markdown",
            ...Markup.keyboard([[CANCEL, SKIP]]).resize()
        });
        ctx.session.title_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 1: Release Date
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^[a-zA-Z0-9\s]+$/.test(text)) {
                return ctx.reply("❌ Invalid title. Only letters and numbers allowed. Try again:");
            }
            message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
                parse_mode: "Markdown",
                ...keyboard
            });
            ctx.wizard.state.movieData.title = text;
        }
        if (ctx?.session?.title_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.title_edit_movie_message_id).catch(console.error);
            delete ctx.session.title_edit_movie_message_id;
        }
        ctx.session.release_date_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 2: Language
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 1, "🎬 Please enter the *Movie Title* again:", "_edit_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply("🗣️ Enter the *Language* (e.g., English, Hindi):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
                return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
            }
            message = await ctx.reply("🗣️ Enter the *Language* (e.g., English, Hindi):", {
                parse_mode: "Markdown",
                ...keyboard
            });
            ctx.wizard.state.movieData.release_date = text;
        }

        if (ctx?.session?.release_date_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.release_date_edit_movie_message_id).catch(console.error);
            delete ctx.session.release_date_edit_movie_message_id;
        }
        ctx.session.language_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 3: Genre
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 2, "📅 Enter the *Release Date* again:", "_edit_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^[a-zA-Z\s,]+$/.test(text)) {
                return ctx.reply("❌ Invalid language. Use only letters. Try again:");
            }
            message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
                parse_mode: "Markdown",
                ...keyboard
            });
            ctx.wizard.state.movieData.language = text;
        }

        if (ctx?.session?.language_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.language_edit_movie_message_id).catch(console.error);
            delete ctx.session.language_edit_movie_message_id;
        }
        ctx.session.genre_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 4: Thumbnail
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 3, "🗣️ Enter the *Language* again:", "_edit_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^[a-zA-Z\s,]+$/.test(text)) {
                return ctx.reply("❌ Invalid genre. Use only letters. Try again:");
            }
            message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
                parse_mode: "Markdown",
                ...keyboard
            });
            ctx.wizard.state.movieData.genre = text;
        }

        if (ctx?.session?.genre_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.genre_edit_movie_message_id).catch(console.error);
            delete ctx.session.genre_edit_movie_message_id;
        }
        ctx.session.thumbnail_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 5: Download Links
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 4, "🎭 Enter the *Genre* again:", "_edit_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply("🔗 Enter *Download Links* (one per line):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^(https?:\/\/[^\s]+)/.test(text)) {
                return ctx.reply("❌ Invalid URL. Please send a valid image URL:");
            }
            message = await ctx.reply("🔗 Enter *Download Links* (one per line):", {
                parse_mode: "Markdown",
                ...keyboard
            });
            ctx.wizard.state.movieData.thumbnail = text;
        }

        if (ctx?.session?.thumbnail_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.thumbnail_edit_movie_message_id).catch(console.error);
            delete ctx.session.thumbnail_edit_movie_message_id;
        }
        ctx.session.download_link_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 6: Qualities
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 5, "🖼️ Send the *Thumbnail URL* again:", "_edit_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply("📽️ Enter *Qualities* for each download link (one per line):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
                return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
            }
            message = await ctx.reply("📽️ Enter *Qualities* for each download link (one per line):", {
                parse_mode: "Markdown",
                ...keyboard
            });
            const urlRegex = /^(https?:\/\/[^\s]+)/;
            const links = text.split("\n").map(l => l.trim()).filter(Boolean);
            const invalidLinks = links.filter(link => !urlRegex.test(link));

            if (invalidLinks.length > 0) {
                return ctx.reply("❌ Some download links are invalid URLs. Please re-enter all links:");
            }

            ctx.wizard.state.movieData.download_link = links;
        }

        if (ctx?.session?.download_link_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_edit_movie_message_id).catch(console.error);
            delete ctx.session.download_link_edit_movie_message_id;
        }
        ctx.session.qualities_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 7: Category
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text && text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text && text === BACK) return scense_stepBack(ctx, 6, "🔗 Enter *Download Links* (one per line) again:", "_add_movie");
        let message
        if (text === SKIP) {
            message = await ctx.reply(
                "🎯 Please select the *Category* of the movie by sending the corresponding number:\n\n" +
                "1️⃣ Bollywood\n" +
                "2️⃣ Hollywood\n" +
                "3️⃣ Hollywood Dual\n" +
                "4️⃣ South Dual\n" +
                "5️⃣ Anime\n" +
                "6️⃣ Other",
                { parse_mode: "Markdown" }
            );
        } else {
            const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
            const links = ctx.wizard.state.movieData.download_link;

            if (qualities.length !== links.length) {
                await ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
                return;
            }

            ctx.wizard.state.movieData.quality = qualities;

            message = await ctx.reply(
                "🎯 Please select the *Category* of the movie by sending the corresponding number:\n\n" +
                "1️⃣ Bollywood\n" +
                "2️⃣ Hollywood\n" +
                "3️⃣ Hollywood Dual\n" +
                "4️⃣ South Dual\n" +
                "5️⃣ Anime\n" +
                "6️⃣ Other",
                { parse_mode: "Markdown" }
            );
        }
        if (ctx?.session?.qualities_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_edit_movie_message_id).catch(console.error);
            delete ctx.session.qualities_edit_movie_message_id;
        }
        ctx.session.category_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 8: Save
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 6, "🔗 Enter *Download Links* again:", "_edit_movie");
        if (text === SKIP) {
            await movies_module.findByIdAndUpdate(ctx.session.movieId, ctx.wizard.state.movieData);
        } else {
            const categories = {
                "1": "Bollywood",
                "2": "Hollywood",
                "3": "Hollywood Dual",
                "4": "South Dual",
                "5": "Anime",
                "6": "Other"
            };

            if (!categories[text]) {
                // Invalid input, ask again
                await ctx.reply("❌ Invalid choice. Please send a number between 1 and 6 corresponding to the category.");
                return; // Stay on same step
            }

            ctx.wizard.state.movieData.category = categories[text];
            await movies_module.findByIdAndUpdate(ctx.session.movieId, ctx.wizard.state.movieData);
        }
        
        let message = await ctx.reply("✅ Movie updated successfully!", Markup.removeKeyboard());

        setTimeout(() => {
            ctx.deleteMessage(message.message_id)
        }, 3000);
        if (ctx.session.editMessageId) {
            try {
                await ctx.deleteMessage(ctx.session.editMessageId);
            } catch (err) {
                console.error("❌ Failed to delete message:", err.message);
            }
        }
        if (ctx?.session?.category_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.category_edit_movie_message_id).catch(console.error);
            delete ctx.session.category_edit_movie_message_id;
        }
        await menu_btn_admin(ctx);
        return ctx.scene.leave();
    }
);

module.exports = updateMovieWizard;
