const { Scenes, Markup } = require("telegraf");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helpers/cancelWizard");
const scense_stepBack = require("../helpers/scense_stepBack");
const shows_module = require("../models/shows_module");
const start_message = require("../helpers/start_message");
const bot = require("../bot_index");

const BACK = "⬅ Back";
const SKIP = "⏭ Skip";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, SKIP, CANCEL]]).resize();

const updateShowWizard = new Scenes.WizardScene(
    "UPDATE_SHOW_SCENE",

    // Step 0: Load show & ask Title
    async (ctx) => {
        if (!ctx.session?.showId) {
            return ctx.reply("⚠️ Show id missing. Pehle show select karke dobara try karein.");
        }

        const showsData = await shows_module.findById(ctx.session.showId).lean();
        if (!showsData) {
            return ctx.reply("⚠️ Show not found. Kucch gadbad hai.");
        }

        ctx.wizard.state.showData = showsData; // full object from DB
        // ensure series array exists
        if (!Array.isArray(ctx.wizard.state.showData.series)) ctx.wizard.state.showData.series = [];

        // Ask for title (pre-filled prompt)
        const message = await ctx.reply(
            `🎬 Current Title: *${ctx.wizard.state.showData.title || "N/A"}*\n\nSend new Title or press Skip to keep it.`,
            { parse_mode: "Markdown", ...Markup.keyboard([[CANCEL, SKIP]]).resize() }
        );
        ctx.session.title_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 1: Title -> Genre
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 0, `🎬 Current Title: *${ctx.wizard.state.showData.title || "N/A"}*\n\nSend new Title or press Skip to keep it.`, "_edit_show");

        if (text !== SKIP) {
            if (!text || !/^[a-zA-Z0-9\s]+$/.test(text)) {
                return ctx.reply("❌ Invalid title. Only letters and numbers allowed. Try again:");
            }
            ctx.wizard.state.showData.title = text.trim();
        }

        // Ask Genre (show current)
        const message = await ctx.reply(
            `🎭 Current Genre: *${ctx.wizard.state.showData.genre || "N/A"}*\n\nSend new Genre or press Skip to keep it.`,
            { parse_mode: "Markdown", ...keyboard }
        );
        if (ctx?.session?.title_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.title_edit_show_message_id).catch(() => { });
            delete ctx.session.title_edit_show_message_id;
        }
        ctx.session.genre_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 2: Genre -> Thumbnail
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 1, `🎬 Current Title: *${ctx.wizard.state.showData.title || "N/A"}*`, "_edit_show");

        if (text !== SKIP) {
            if (!text || !/^[a-zA-Z\s,]+$/.test(text)) {
                return ctx.reply("❌ Invalid genre. Use only letters. Try again:");
            }
            ctx.wizard.state.showData.genre = text.trim();
        }

        const message = await ctx.reply(
            `🖼️ Current Thumbnail: ${ctx.wizard.state.showData.thumbnail || "N/A"}\n\nSend new Thumbnail URL or press Skip to keep it.`,
            { parse_mode: "Markdown", ...keyboard }
        );

        if (ctx?.session?.genre_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.genre_edit_show_message_id).catch(() => { });
            delete ctx.session.genre_edit_show_message_id;
        }
        ctx.session.thumbnail_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 3: Thumbnail -> Category
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 2, `🎭 Current Genre: *${ctx.wizard.state.showData.genre || "N/A"}*`, "_edit_show");

        if (text !== SKIP) {
            const urlRegex = /^(https?:\/\/[^\s]+)/;
            if (!text || !urlRegex.test(text)) {
                return ctx.reply("❌ Invalid URL. Please send a valid image URL or press Skip:");
            }
            ctx.wizard.state.showData.thumbnail = text.trim();
        }

        // Ask for Category (show current)
        const message = await ctx.reply(
            `🎯 Current Category: *${ctx.wizard.state.showData.category || "N/A"}*\n\nSend number to change or press Skip to keep it:\n\n1️⃣ Bollywood\n2️⃣ Hollywood\n3️⃣ Hollywood Dual\n4️⃣ South Dual\n5️⃣ Anime\n6️⃣ Other`,
            { parse_mode: "Markdown", ...keyboard }
        );

        if (ctx?.session?.thumbnail_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.thumbnail_edit_show_message_id).catch(() => { });
            delete ctx.session.thumbnail_edit_show_message_id;
        }
        ctx.session.category_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 4: Category -> Season selection / add-new prompt
    async (ctx) => {
        const text = (ctx.message?.text || "").trim();
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 3, `🖼️ Current Thumbnail: ${ctx.wizard.state.showData.thumbnail || "N/A"}`, "_edit_show");

        const categoriesMap = {
            "1": "Bollywood",
            "2": "Hollywood",
            "3": "Hollywood Dual",
            "4": "South Dual",
            "5": "Anime",
            "6": "Other"
        };

        if (text && text !== SKIP) {
            if (!categoriesMap[text]) {
                return ctx.reply("❌ Invalid category. Send a number between 1 and 6, or press Skip.");
            }
            ctx.wizard.state.showData.category = categoriesMap[text];
        }

        // cleanup
        if (ctx?.session?.category_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.category_edit_show_message_id).catch(() => { });
            delete ctx.session.category_edit_show_message_id;
        }

        // Now handle seasons: if existing seasons -> ask which to edit, otherwise ask for new season release date
        const series = ctx.wizard.state.showData.series || [];

        if (series.length === 0) {
            // no seasons -> start adding new season
            ctx.wizard.state.currentSeason = {};
            const msg = await ctx.reply("📅 Enter the *Release Date* for the new season (e.g., 01 Jan 2025):", { parse_mode: "Markdown", ...keyboard });
            ctx.session.release_date_edit_show_message_id = msg.message_id;
            return ctx.wizard.next();
        } else {
            // list seasons and let admin choose or add new
            let messageText = "📌 Select the season you want to edit by sending the number, or send a larger number to add a new season:\n\n";
            series.forEach((s, idx) => {
                const rd = s.release_date || "N/A";
                messageText += `${idx + 1}️⃣ Season ${idx + 1} — ${rd}\n`;
            });
            messageText += `\n⏭ Send a number greater than ${series.length} to add a new season\n\n(Or send ${SKIP} to skip season edits)`;

            const message = await ctx.reply(messageText, { parse_mode: "Markdown", ...keyboard });
            ctx.session.season_select_edit_message_id = message.message_id;
            return ctx.wizard.next();
        }
    },

    // Step 5: Season selection / Release Date for chosen season
    async (ctx) => {
        const raw = ctx.message?.text;
        const text = raw ? raw.trim() : "";
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) {
            // go back to category step
            return scense_stepBack(ctx, 4, `🎯 Current Category: *${ctx.wizard.state.showData.category || "N/A"}*\n\nSend number to change or press Skip to keep it.`, "_edit_show");
        }

        const series = ctx.wizard.state.showData.series || [];

        if (text === SKIP) {
            // skip seasons editing, jump to final confirm/save
            await ctx.reply("✅ No season changes made. You can Complete the update or re-open edit later.", {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Complete Show Update", "COMPLETE_UPDATE")],
                ])
            });
            return ctx.scene.leave(); // or you may prefer to let them press Complete — using leave here for simplicity
        }

        if (/^\d+$/.test(text)) {
            const num = parseInt(text, 10);

            if (series.length > 0 && num >= 1 && num <= series.length) {
                // edit existing season
                const idx = num - 1;
                // clone season to edit
                ctx.wizard.state.currentSeason = Object.assign({}, series[idx]);
                ctx.wizard.state.currentSeasonIndex = idx;

                if (ctx?.session?.season_select_edit_message_id) {
                    await ctx.deleteMessage(ctx.session.season_select_edit_message_id).catch(() => { });
                    delete ctx.session.season_select_edit_message_id;
                }

                const msg = await ctx.reply(`📅 Current Release Date for Season ${num}: *${ctx.wizard.state.currentSeason.release_date || "N/A"}*\n\nSend new Release Date or press Skip to keep it.`, { parse_mode: "Markdown", ...keyboard });
                ctx.session.release_date_edit_show_message_id = msg.message_id;
                return ctx.wizard.next();
            }

            // number > series.length -> add new season
            if (num > series.length) {
                ctx.wizard.state.currentSeason = {};
                delete ctx.wizard.state.currentSeasonIndex;

                if (ctx?.session?.season_select_edit_message_id) {
                    await ctx.deleteMessage(ctx.session.season_select_edit_message_id).catch(() => { });
                    delete ctx.session.season_select_edit_message_id;
                }

                const msg = await ctx.reply("📅 Enter the *Release Date* for the new season (e.g., 01 Jan 2025):", { parse_mode: "Markdown", ...keyboard });
                ctx.session.release_date_edit_show_message_id = msg.message_id;
                return ctx.wizard.next();
            }
        }

        // if not numeric and no session message exists, remind user
        if (!ctx?.session?.season_select_edit_message_id) {
            const message = await ctx.reply("📌 Please send the season number to edit (e.g., `1`) or a larger number to add a new season. Or press Skip to skip.");
            ctx.session.season_select_edit_message_id = message.message_id;
            return;
        } else {
            await ctx.reply("📌 Please send a valid season number or a larger number to add a new season.");
            return;
        }
    },

    // Step 6: Release Date for currentSeason -> ask Language
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) {
            // go back to season selection prompt
            const series = ctx.wizard.state.showData.series || [];
            if (!series.length) {
                // no prior seasons -> back to category
                return scense_stepBack(ctx, 4, `🎯 Current Category: *${ctx.wizard.state.showData.category || "N/A"}*`, "_edit_show");
            }
            let messageText = "📌 Select the season you want to edit by sending the corresponding number:\n\n";
            series.forEach((s, idx) => {
                messageText += `${idx + 1}️⃣ Season ${idx + 1} — ${s.release_date || "N/A"}\n`;
            });
            messageText += `\n⏭ Send a number greater than ${series.length} to add a new season\n\n(Or send ${SKIP} to skip season edits)`;
            return scense_stepBack(ctx, 5, messageText, "_edit_show");
        }

        if (text !== SKIP) {
            if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
                return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
            }
            ctx.wizard.state.currentSeason.release_date = text.trim();
        }

        const msg = await ctx.reply(`🗣️ Current Language: *${(ctx.wizard.state.currentSeason.language || ctx.wizard.state.showData.language) || "N/A"}*\n\nSend new Language for this season or press Skip to keep it.`, { parse_mode: "Markdown", ...keyboard });

        if (ctx?.session?.release_date_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.release_date_edit_show_message_id).catch(() => { });
            delete ctx.session.release_date_edit_show_message_id;
        }
        ctx.session.language_edit_show_message_id = msg.message_id;
        return ctx.wizard.next();
    },

    // Step 7: Language -> Download Links
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 6, `📅 Enter the *Release Date* for this season (e.g., 01 Jan 2025):`, "_edit_show");

        if (text !== SKIP) {
            if (!/^[a-zA-Z\s,]+$/.test(text)) {
                return ctx.reply("❌ Invalid language. Use only letters. Try again:");
            }
            ctx.wizard.state.currentSeason.language = text.trim();
        }

        const msg = await ctx.reply(`🔗 Enter *Download Links* for this season (one per line). Current links:\n\n${(ctx.wizard.state.currentSeason.download_link || []).map((l, i) => `${i + 1}. ${l}`).join("\n") || "N/A"}`, { parse_mode: "Markdown", disable_web_page_preview: true, ...keyboard });

        if (ctx?.session?.language_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.language_edit_show_message_id).catch(() => { });
            delete ctx.session.language_edit_show_message_id;
        }
        ctx.session.download_link_edit_show_message_id = msg.message_id;
        return ctx.wizard.next();
    },

    // Step 8: Download Links -> Qualities
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) {
            // go back to language step
            return scense_stepBack(ctx, 7, `🗣️ Enter the *Language* for this season (e.g., English, Hindi):`, "_edit_show");
        }

        if (text !== SKIP) {
            const urlRegex = /^(https?:\/\/[^\s]+)/;
            const links = text.split("\n").map(l => l.trim()).filter(Boolean);
            const invalidLinks = links.filter(l => !urlRegex.test(l));
            if (invalidLinks.length > 0) {
                return ctx.reply("❌ Some download links are invalid URLs. Please re-enter all links:");
            }
            ctx.wizard.state.currentSeason.download_link = links;
        }

        const msg = await ctx.reply(`🎮 Enter *Qualities* for each download link (one per line). Current qualities:\n\n${(ctx.wizard.state.currentSeason.quality || []).map((q, i) => `${i + 1}. ${q}`).join("\n") || "N/A"}`, { parse_mode: "Markdown", ...keyboard });

        if (ctx?.session?.download_link_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_edit_show_message_id).catch(() => { });
            delete ctx.session.download_link_edit_show_message_id;
        }
        ctx.session.qualities_edit_show_message_id = msg.message_id;
        return ctx.wizard.next();
    },

    // Step 9: Qualities -> Save season & ask next action
    async (ctx) => {
        const text = ctx.message?.text;
        if (text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 7, `🔗 Enter *Download Links* for this season (one per line):`, "_edit_show");

        if (text !== SKIP) {
            const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
            const links = ctx.wizard.state.currentSeason.download_link || [];

            if (qualities.length !== links.length) {
                return ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
            }
            ctx.wizard.state.currentSeason.quality = qualities;
        }

        // Save to series: update existing or push new
        if (typeof ctx.wizard.state.currentSeasonIndex === "number") {
            ctx.wizard.state.showData.series[ctx.wizard.state.currentSeasonIndex] = ctx.wizard.state.currentSeason;
        } else {
            ctx.wizard.state.showData.series.push(ctx.wizard.state.currentSeason);
        }

        // cleanup session messages
        if (ctx?.session?.qualities_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_edit_show_message_id).catch(() => { });
            delete ctx.session.qualities_edit_show_message_id;
        }
        if (ctx?.session?.download_link_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_edit_show_message_id).catch(() => { });
            delete ctx.session.download_link_edit_show_message_id;
        }

        // ask next action
        await ctx.reply("✅ *Season saved*. What would you like to do next?", {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("➕ Add Another Season", "ADD_ANOTHER_SEASON")],
                [Markup.button.callback("✅ Complete Show Update", "COMPLETE_UPDATE")]
            ])
        });

        return ctx.wizard.next();
    },

    // Step 10: Handle callbacks (ADD_ANOTHER_SEASON / COMPLETE_UPDATE)
    async (ctx) => {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        await ctx.answerCbQuery();

        if (data === "ADD_ANOTHER_SEASON") {
            // prepare to add new season: reset currentSeason and go to release_date step (index 6)
            ctx.wizard.state.currentSeason = {};
            delete ctx.wizard.state.currentSeasonIndex;

            try {
                await ctx.editMessageText("📅 Enter the *Release Date* for the new season (e.g., 01 Jan 2025):", { parse_mode: "Markdown", reply_markup: Markup.inlineKeyboard([]) });
            } catch (e) { /* ignore edit errors */ }

            return ctx.wizard.selectStep(6); // index 6 handles Release Date
        }

        if (data === "COMPLETE_UPDATE") {
            try {
                await shows_module.findByIdAndUpdate(ctx.session.showId, ctx.wizard.state.showData, { new: true });
                const msg = await ctx.reply("✅ Show updated successfully!", Markup.removeKeyboard());
                setTimeout(async () => {
                    await ctx.deleteMessage(msg.message_id).catch(() => { });
                    await menu_btn_admin(ctx);
                }, 1000);

                // clean session keys (optional)
                const keys = [
                    "title_edit_show_message_id", "genre_edit_show_message_id", "thumbnail_edit_show_message_id",
                    "category_edit_show_message_id", "season_select_edit_message_id", "release_date_edit_show_message_id",
                    "language_edit_show_message_id", "download_link_edit_show_message_id", "qualities_edit_show_message_id"
                ];
                keys.forEach(k => { if (ctx.session?.[k]) delete ctx.session[k]; });

                return ctx.scene.leave();
            } catch (err) {
                console.error("❌ Error updating show:", err);
                return ctx.reply("⚠️ Failed to update the show. Please try again later.");
            }
        }
    }
);

module.exports = updateShowWizard;
