const { Scenes, Markup } = require("telegraf");
const movies_module = require("../model/movies_module");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helper/cancelWizard");
const scense_stepBack = require("../helper/scense_stepBack");

const BACK = "⬅ Back";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, CANCEL]]).resize();

const updateMovieWizard = new Scenes.WizardScene(
    "UPDATE_MOVIE_SCENE",

    // Step 0: Title
    async (ctx) => {
        ctx.wizard.state.movieData = {};
        let message = await ctx.reply("🎬 Please enter the *Movie Title*:", {
            parse_mode: "Markdown",
            ...Markup.keyboard([[CANCEL]]).resize()
        });
        ctx.session.title_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 1: Release Date
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");

        if (!/^[a-zA-Z0-9\s]+$/.test(text)) {
            return ctx.reply("❌ Invalid title. Only letters and numbers allowed. Try again:");
        }

        ctx.wizard.state.movieData.title = text;
        let message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
            parse_mode: "Markdown",
            ...keyboard
        });
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
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 1, "🎬 Please enter the *Movie Title* again:", "_edit_movie");

        if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
            return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
        }

        ctx.wizard.state.movieData.release_date = text;
        let message = await ctx.reply("🗣️ Enter the *Language* (e.g., English, Hindi):", {
            parse_mode: "Markdown",
            ...keyboard
        });
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
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 2, "📅 Enter the *Release Date* again:", "_edit_movie");

        if (!/^[a-zA-Z\s]+$/.test(text)) {
            return ctx.reply("❌ Invalid language. Use only letters. Try again:");
        }

        ctx.wizard.state.movieData.language = text;
        let message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
            parse_mode: "Markdown",
            ...keyboard
        });
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
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 3, "🗣️ Enter the *Language* again:", "_edit_movie");

        if (!/^[a-zA-Z\s]+$/.test(text)) {
            return ctx.reply("❌ Invalid genre. Use only letters. Try again:");
        }

        ctx.wizard.state.movieData.genre = text;
        let message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
            parse_mode: "Markdown",
            ...keyboard
        });
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
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 4, "🎭 Enter the *Genre* again:", "_edit_movie");

        if (!/^(https?:\/\/[^\s]+)/.test(text)) {
            return ctx.reply("❌ Invalid URL. Please send a valid image URL:");
        }

        ctx.wizard.state.movieData.thumbnail = text;
        let message = await ctx.reply("🔗 Enter *Download Links* (one per line):", {
            parse_mode: "Markdown",
            ...keyboard
        });
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
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 5, "🖼️ Send the *Thumbnail URL* again:", "_edit_movie");

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
        if (ctx?.session?.download_link_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_edit_movie_message_id).catch(console.error);
            delete ctx.session.download_link_edit_movie_message_id;
        }
        ctx.session.qualities_edit_movie_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 7: Save
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_edit_movie");
        if (text === BACK) return scense_stepBack(ctx, 6, "🔗 Enter *Download Links* again:", "_edit_movie");

        const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
        const links = ctx.wizard.state.movieData.download_link;

        if (qualities.length !== links.length) {
            await ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
            return;
        }

        ctx.wizard.state.movieData.quality = qualities;

        await movies_module.findByIdAndUpdate(ctx.session.movieId, ctx.wizard.state.movieData);

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
        if (ctx?.session?.qualities_edit_movie_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_edit_movie_message_id).catch(console.error);
            delete ctx.session.qualities_edit_movie_message_id;
        }
        await menu_btn_admin(ctx);
        return ctx.scene.leave();
    }
);

module.exports = updateMovieWizard;
