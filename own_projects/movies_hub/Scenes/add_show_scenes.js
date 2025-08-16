const { Scenes, Markup } = require("telegraf");
const shows_module = require("../model/shows_module");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helper/cancelWizard");
const scense_stepBack = require("../helper/scense_stepBack");
const start_message = require("../helper/start_message");
const bot = require("../bot_index");
const BACK = "⬅ Back";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, CANCEL]]).resize();

const addShowWizard = new Scenes.WizardScene(
    "ADD_SHOW_SCENE",

    // Step 0: Title
    async (ctx) => {
        ctx.wizard.state.showData = { series: [] };
        let message = await ctx.reply("🎬 Please enter the *Show Title*:", {
            parse_mode: "Markdown",
            ...Markup.keyboard([[CANCEL]]).resize()
        });
        ctx.session.title_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 1: Release Date
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!/^[a-zA-Z0-9\s]+$/.test(text)) {
            return ctx.reply("❌ Invalid title. Only letters and numbers allowed. Try again:");
        }

        ctx.wizard.state.showData.title = text;
        let message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.title_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.title_add_show_message_id).catch(console.error);
            delete ctx.session.title_add_show_message_id;
        }
        ctx.session.release_date_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 2: Language
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 1, "🎬 Please enter the *Show Title* again:", "_add_show");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
            return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
        }

        ctx.wizard.state.showData.release_date = text;
        let message = await ctx.reply("🗣️ Enter the *Language* (e.g., English, Hindi):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.release_date_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.release_date_add_show_message_id).catch(console.error);
            delete ctx.session.release_date_add_show_message_id;
        }
        ctx.session.language_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 3: Genre
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 2, "📅 Enter the *Release Date* again:", "_add_show");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!/^[a-zA-Z\s]+$/.test(text)) {
            return ctx.reply("❌ Invalid language. Use only letters. Try again:");
        }

        ctx.wizard.state.showData.language = text;
        let message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.language_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.language_add_show_message_id).catch(console.error);
            delete ctx.session.language_add_show_message_id;
        }
        ctx.session.genre_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 4: Thumbnail
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 3, "🗣️ Enter the *Language* again:", "_add_show");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        if (!/^[a-zA-Z\s]+$/.test(text)) {
            return ctx.reply("❌ Invalid genre. Use only letters. Try again:");
        }

        ctx.wizard.state.showData.genre = text;
        let message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.genre_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.genre_add_show_message_id).catch(console.error);
            delete ctx.session.genre_add_show_message_id;
        }
        ctx.session.thumbnail_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 5: Thumbnail URL
    async (ctx) => {
        const text = ctx?.message?.text;
        if (text) {
            if (text === CANCEL) return cancelWizard(ctx, "_add_show");
            if (text === BACK) return scense_stepBack(ctx, 4, "🎭 Enter the *Genre* again:", "_add_show");
            if (ctx.message.text === '/start') {
                return start_message(bot, ctx)
            }

            const urlRegex = /^(https?:\/\/[^\s]+)/;
            if (!urlRegex.test(text)) {
                return ctx.reply("❌ Invalid URL. Please send a valid image URL:");
            }

            ctx.wizard.state.showData.thumbnail = text;
        }
        ctx.wizard.state.currentSeason = {};

        let message = await ctx.reply("🔗 Enter *Download Links* for this season (one per line):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.thumbnail_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.thumbnail_add_show_message_id).catch(console.error);
            delete ctx.session.thumbnail_add_show_message_id;
        }
        ctx.session.download_link_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 6: Download links
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 5, "🖼️ Send the *Thumbnail URL* again:", "_add_show");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        const urlRegex = /^(https?:\/\/[^\s]+)/;
        const links = text.split("\n").map(l => l.trim()).filter(Boolean);
        const invalidLinks = links.filter(link => !urlRegex.test(link));

        if (invalidLinks.length > 0) {
            return ctx.reply("❌ Some download links are invalid URLs. Please re-enter all links:");
        }

        ctx.wizard.state.currentSeason.download_link = links;
        let message = await ctx.reply("🎮 Enter *Qualities* for each download link (one per line):", {
            parse_mode: "Markdown",
            ...keyboard
        });
        if (ctx?.session?.download_link_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_add_show_message_id).catch(console.error);
            delete ctx.session.download_link_add_show_message_id;
        }
        ctx.session.qualities_add_show_message_id = message.message_id
        return ctx.wizard.next();
    },

    // Step 7: Qualities & Save
    async (ctx) => {
        const text = ctx.message.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 6, "🔗 Enter *Download Links* again:", "_add_show");
        if (ctx.message.text === '/start') {
            return start_message(bot, ctx)
        }

        const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
        const links = ctx.wizard.state.currentSeason.download_link;

        if (qualities.length !== links.length) {
            await ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
            return;
        }

        ctx.wizard.state.currentSeason.quality = qualities;
        ctx.wizard.state.showData.series.push(ctx.wizard.state.currentSeason);

        await ctx.reply("✅ *Season added*. What would you like to do next?", {
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("➕ Add Another Season", "ADD_ANOTHER_SEASON")],
                [Markup.button.callback("✅ Complete Show Setup", "COMPLETE_SHOW_SETUP")]
            ]).reply_markup // ← yeh zaroori hai
        });

        if (ctx?.session?.qualities_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_add_show_message_id).catch(console.error);
            delete ctx.session.qualities_add_show_message_id;
        }

        return ctx.wizard.next();
    },

    // Step 8: Handle button callbacks
    async (ctx) => {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        await ctx.answerCbQuery(); // Acknowledge the button press

        if (data === "ADD_ANOTHER_SEASON") {
            ctx.wizard.state.currentSeason = {};
            await ctx.editMessageText("🔗 Enter *Download Links* for this season (one per line):", {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([])
            });
            return ctx.wizard.selectStep(6); // Jump to Step 6
        }

        if (data === "COMPLETE_SHOW_SETUP") {
            try {
                const show = new shows_module(ctx.wizard.state.showData);
                await show.save();
                let message = await ctx.reply("✅ Show added successfully!", Markup.removeKeyboard());
                setTimeout(async () => {
                    await ctx.deleteMessage(message.message_id);
                    await menu_btn_admin(ctx);
                }, 1000);
                return ctx.scene.leave();
            } catch (error) {
                console.error("❌ Error saving show:", error);
                return ctx.reply("⚠️ Failed to save the show. Please try again later.");
            }
        }
    }

);

module.exports = addShowWizard;
