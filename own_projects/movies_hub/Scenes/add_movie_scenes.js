const { Scenes, Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helper/cancelWizard");
const scense_stepBack = require("../helper/scense_stepBack");
const start_message = require("../helper/start_message");
const bot = require("../bot_index");

const BACK = "⬅ Back";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, CANCEL]]).resize();

const addMovieWizard = new Scenes.WizardScene(
    "ADD_MOVIE_SCENE",

    // Step 0: Title
    async (ctx) => {
        ctx.wizard.state.movieData = {};
        let message = await ctx.reply("🎬 Please enter the *Movie Title*:", {
            parse_mode: "Markdown",
            ...Markup.keyboard([[CANCEL]]).resize()
        });
        ctx.session.title_add_movie_message_id = message.message_id

        return ctx.wizard.next();
    },

    // Step 1: Release Date
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        ctx.wizard.state.movieData.title = text;
        let message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.title_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.title_add_movie_message_id).catch(console.error);
            delete ctx.session.title_add_movie_message_id;
        }
        ctx.session.release_date_add_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 2: Language
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text === BACK) return scense_stepBack(ctx, 1, "🎬 Please enter the *Movie Title* again:", "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }
        if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
            return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025",);
        }

        ctx.wizard.state.movieData.release_date = text;
        let message = await ctx.reply("🗣️ Enter the *language* (e.g., English, Hindi):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.release_date_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.release_date_add_movie_message_id).catch(console.error);
            delete ctx.session.release_date_add_movie_message_id;
        }
        ctx.session.language_add_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 3: Genre
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text === BACK) return scense_stepBack(ctx, 2, "📅 Enter the *Release Date* again:", "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!/^[a-zA-Z\s,]+$/.test(text)) {
            return ctx.reply("❌ Invalid language. Use only letters and commas. Try again:");
        }

        ctx.wizard.state.movieData.language = text;
        let message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.language_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.language_add_movie_message_id).catch(console.error);
            delete ctx.session.language_add_movie_message_id;
        }
        ctx.session.genre_add_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 4: Thumbnail
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text === BACK) return scense_stepBack(ctx, 3, "🗣️ Enter the *Language* again:", "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!/^[a-zA-Z\s,]+$/.test(text)) {
            return ctx.reply("❌ Invalid genre. Use only letters. Try again:");
        }

        ctx.wizard.state.movieData.genre = text;
        let message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.genre_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.genre_add_movie_message_id).catch(console.error);
            delete ctx.session.genre_add_movie_message_id;
        }
        ctx.session.thumbnail_add_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 5: Download Links
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text === BACK) return scense_stepBack(ctx, 4, "🎭 Enter the *Genre* again:", "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        const urlRegex = /^(https?:\/\/[^\s]+)/;
        if (!urlRegex.test(text)) {
            return ctx.reply("❌ Invalid URL. Please send a valid image URL:");
        }

        ctx.wizard.state.movieData.thumbnail = text;
        let message = await ctx.reply("🔗 Enter *Download Links* (one per line):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.thumbnail_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.thumbnail_add_movie_message_id).catch(console.error);
            delete ctx.session.thumbnail_add_movie_message_id;
        }
        ctx.session.download_link_add_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 6: Qualities
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text === BACK) return scense_stepBack(ctx, 5, "🖼️ Send the *Thumbnail URL* again:", "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        const urlRegex = /^(https?:\/\/[^\s]+)/;
        const links = text.split("\n").map(l => l.trim()).filter(Boolean);
        const invalidLinks = links.filter(link => !urlRegex.test(link));

        if (invalidLinks.length > 0) {
            return ctx.reply("❌ Some download links are invalid URLs. Please re-enter all links:");
        }

        ctx.wizard.state.movieData.download_link = links;

        let message = await ctx.reply("📽️ Enter *Qualities* for each download link (one per line):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.download_link_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_add_movie_message_id).catch(console.error);
            delete ctx.session.download_link_add_movie_message_id;
        }
        ctx.session.qualities_add_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 7: Category
    async (ctx) => {
        const text = ctx.message.text;
        if (text && text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text && text === BACK) return scense_stepBack(ctx, 6, "🔗 Enter *Download Links* (one per line) again:", "_add_movie");
        if (text && text === '/start') return start_message(bot, ctx);

        const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
        const links = ctx.wizard.state.movieData.download_link;

        if (qualities.length !== links.length) {
            await ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
            return;
        }

        ctx.wizard.state.movieData.quality = qualities;

        // If category not yet selected, prompt user
        await ctx.reply(
            "🎯 Please select the *Category* of the movie by sending the corresponding number:\n\n" +
            "1️⃣ Bollywood\n" +
            "2️⃣ Hollywood\n" +
            "3️⃣ Hollywood Dual\n" +
            "4️⃣ South Dual\n" +
            "5️⃣ Anime\n" +
            "6️⃣ Other",
            { parse_mode: "Markdown" }
        );
        return ctx.wizard.next();
    },

    // Step 8: Save
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_movie");
        if (text === BACK) return scense_stepBack(ctx, 7, "📽️ Enter *Qualities* for each download link (one per line):", "_add_movie");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

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

        const movie = new movies_module(ctx.wizard.state.movieData);
        await movie.save();

        let message = await ctx.reply("✅ Movie added successfully!", Markup.removeKeyboard());
        setTimeout(() => {
            ctx.deleteMessage(message.message_id)
        }, 3000);
        await menu_btn_admin(ctx);
        if (ctx?.session?.qualities_add_movie_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_add_movie_message_id).catch(console.error);
            delete ctx.session.qualities_add_movie_message_id;
        }
        return ctx.scene.leave();
    }
);

module.exports = addMovieWizard;
