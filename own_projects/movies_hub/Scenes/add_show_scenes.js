const { Scenes, Markup } = require("telegraf");
const shows_module = require("../models/shows_module");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helpers/cancelWizard");
const scense_stepBack = require("../helpers/scense_stepBack");
const start_message = require("../helpers/start_message");
const bot = require("../bot_index");

const BACK = "⬅ Back";
const SKIP = "⏭ Skip";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, SKIP, CANCEL]]).resize();

const addShowWizard = new Scenes.WizardScene(
    "ADD_SHOW_SCENE",

    // Step 0: Ask Title
    async (ctx) => {
        ctx.wizard.state.showData = { series: [] };
        let message = await ctx.reply("🎬 Please enter the *Show Title*:", {
            parse_mode: "Markdown",
            ...Markup.keyboard([[CANCEL, SKIP]]).resize()
        });
        ctx.session.title_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 1: Receive Title -> Ask Genre
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === '/start') return start_message(bot, ctx);
        if (!text || text.trim().length === 0) {
            return ctx.reply("❌ Title can't be empty. Please enter the Show Title:");
        }

        // Save title
        ctx.wizard.state.showData.title = text.trim();

        // Ask for Genre
        let message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
            parse_mode: "Markdown",
            ...keyboard
        });

        if (ctx?.session?.title_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.title_add_show_message_id).catch(console.error);
            delete ctx.session.title_add_show_message_id;
        }
        ctx.session.genre_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 2: Receive Genre -> Ask Thumbnail URL
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 0, "🎬 Please enter the *Show Title* again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

        ctx.wizard.state.showData.genre = text.trim();

        let message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
            parse_mode: "Markdown",
            ...keyboard
        });

        if (ctx?.session?.genre_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.genre_add_show_message_id).catch(console.error);
            delete ctx.session.genre_add_show_message_id;
        }
        ctx.session.thumbnail_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 3: Receive Thumbnail -> Ask Category
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 1, "🎭 Enter the *Genre* again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

        const urlRegex = /^(https?:\/\/[^\s]+)/;
        if (!text || !urlRegex.test(text)) {
            return ctx.reply("❌ Invalid URL. Please send a valid image URL:");
        }

        ctx.wizard.state.showData.thumbnail = text.trim();

        let message = await ctx.reply(
            "🎯 Please select the *Category* of the movie by sending the corresponding number:\n\n" +
            "1️⃣ Bollywood\n" +
            "2️⃣ Hollywood\n" +
            "3️⃣ Hollywood Dual\n" +
            "4️⃣ South Dual\n" +
            "5️⃣ Anime\n" +
            "6️⃣ Other",
            { parse_mode: "Markdown" }
        );

        if (ctx?.session?.thumbnail_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.thumbnail_add_show_message_id).catch(console.error);
            delete ctx.session.thumbnail_add_show_message_id;
        }
        ctx.session.category_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 4: Receive Category -> Start per-season flow (ask Release Date)
    async (ctx) => {
        const text = ctx?.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 2, "🖼️ Send the *Thumbnail URL* again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

        const categories = {
            "1": "Bollywood",
            "2": "Hollywood",
            "3": "Hollywood Dual",
            "4": "South Dual",
            "5": "Anime",
            "6": "Other"
        };

        if (!categories[text]) {
            await ctx.reply("❌ Invalid choice. Please send a number between 1 and 6 corresponding to the category.");
            return; // stay on same step
        }

        ctx.wizard.state.showData.category = categories[text];

        // Prepare for per-season inputs
        ctx.wizard.state.currentSeason = {};

        // Ask for Release Date for the first season (per-season)
        let message = await ctx.reply("📅 Enter the *Release Date* for this season (e.g., 01 Jan 2025):", {
            parse_mode: "Markdown",
            ...keyboard
        });

        if (ctx?.session?.category_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.category_add_show_message_id).catch(console.error);
            delete ctx.session.category_add_show_message_id;
        }
        ctx.session.release_date_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 5: Release Date (per-season) -> Ask Language
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 3, "🎯 Please select the *Category* of the movie by sending the number again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

        if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
            return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
        }

        ctx.wizard.state.currentSeason.release_date = text.trim();

        let message = await ctx.reply("🗣️ Enter the *Language* for this season (e.g., English, Hindi):", {
            parse_mode: "Markdown",
            ...keyboard
        });

        if (ctx?.session?.release_date_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.release_date_add_show_message_id).catch(console.error);
            delete ctx.session.release_date_add_show_message_id;
        }
        ctx.session.language_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 6: Language (per-season) -> Ask Download Links
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 4, "📅 Enter the *Release Date* for this season again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

        if (!/^[a-zA-Z\s,]+$/.test(text)) {
            return ctx.reply("❌ Invalid language. Use only letters. Try again:");
        }

        ctx.wizard.state.currentSeason.language = text.trim();

        let message = await ctx.reply("🔗 Enter *Download Links* for this season (one per line):", {
            parse_mode: "Markdown",
            ...keyboard
        });

        if (ctx?.session?.language_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.language_add_show_message_id).catch(console.error);
            delete ctx.session.language_add_show_message_id;
        }
        ctx.session.download_link_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 7: Download links (per-season) -> Ask Qualities
    async (ctx) => {
        const text = ctx?.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 5, "🗣️ Enter the *Language* for this season again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

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
        ctx.session.qualities_add_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 8: Qualities (per-season) -> Save season & ask add another / complete
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === CANCEL) return cancelWizard(ctx, "_add_show");
        if (text === BACK) return scense_stepBack(ctx, 6, "🔗 Enter *Download Links* (one per line) again:", "_add_show");
        if (text === '/start') return start_message(bot, ctx);

        const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
        const links = ctx.wizard.state.currentSeason.download_link;

        if (!links) {
            return ctx.reply("⚠️ No download links found. Please enter download links first.");
        }

        if (qualities.length !== links.length) {
            await ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
            return;
        }

        ctx.wizard.state.currentSeason.quality = qualities;

        // Push this season into showData
        ctx.wizard.state.showData.series.push(ctx.wizard.state.currentSeason);

        await ctx.reply("✅ *Season added*. What would you like to do next?", {
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("➕ Add Another Season", "ADD_ANOTHER_SEASON")],
                [Markup.button.callback("✅ Complete Show Setup", "COMPLETE_SHOW_SETUP")]
            ]).reply_markup
        });

        if (ctx?.session?.qualities_add_show_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_add_show_message_id).catch(console.error);
            delete ctx.session.qualities_add_show_message_id;
        }
        // keep a small reference if needed
        return ctx.wizard.next();
    },

    // Step 9: Handle button callbacks (ADD_ANOTHER_SEASON -> go to Release Date step index 5)
    async (ctx) => {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        await ctx.answerCbQuery();

        if (data === "ADD_ANOTHER_SEASON") {
            // Reset currentSeason and start again from Release Date step (which receives inputs at step index 5)
            ctx.wizard.state.currentSeason = {};

            try {
                await ctx.editMessageText("📅 Enter the *Release Date* for this season (e.g., 01 Jan 2025):", {
                    parse_mode: "Markdown",
                    reply_markup: Markup.inlineKeyboard([]),
                });
            } catch (err) {
                // ignore if editing fails (message might be gone)
            }

            return ctx.wizard.selectStep(5); // Jump to Release Date handler step
        }

        if (data === "COMPLETE_SHOW_SETUP") {
            try {
                const show = new shows_module(ctx.wizard.state.showData);
                await show.save();
                let message = await ctx.reply("✅ Show added successfully!", Markup.removeKeyboard());
                setTimeout(async () => {
                    try {
                        await ctx.deleteMessage(message.message_id);
                    } catch (e) { /* ignore */ }
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
