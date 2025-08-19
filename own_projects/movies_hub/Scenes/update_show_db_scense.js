const { Scenes, Markup } = require("telegraf");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const cancelWizard = require("../helper/cancelWizard");
const scense_stepBack = require("../helper/scense_stepBack");
const shows_module = require("../model/shows_module");

const BACK = "⬅ Back";
const SKIP = "⏭ Skip";
const CANCEL = "❌ Cancel";
const keyboard = Markup.keyboard([[BACK, SKIP, CANCEL]]).resize();

const updateShowWizard = new Scenes.WizardScene(
    "UPDATE_SHOW_SCENE",

    // Step 0: Title
    async (ctx) => {
        let showsData = await shows_module.findById(ctx.session.showId);
        ctx.wizard.state.showData = showsData || {};
        let message = await ctx.reply("🎬 Please enter the *Show Title*:", {
            parse_mode: "Markdown",
            ...Markup.keyboard([[CANCEL, SKIP]]).resize()
        });
        ctx.session.title_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 1: Release Date
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");

        let message;
        if (text === SKIP) {
            message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^[a-zA-Z0-9\s]+$/.test(text)) {
                return ctx.reply("❌ Invalid title. Only letters and numbers allowed. Try again:");
            }
            ctx.wizard.state.showData.title = text;
            message = await ctx.reply("📅 Enter the *Release Date* (e.g., 01 Jan 2025):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        }

        if (ctx?.session?.title_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.title_edit_show_message_id).catch(console.error);
            delete ctx.session.title_edit_show_message_id;
        }
        ctx.session.release_date_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 2: Language
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 1, "🎬 Please enter the *Show Title* again:", "_edit_show");

        let message;
        if (text === SKIP) {
            message = await ctx.reply("🗣️ Enter the *Language* (e.g., English, Hindi):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^\d{2} [A-Z][a-z]{2} \d{4}$/.test(text)) {
                return ctx.reply("❌ Invalid date. Format should be like: 01 Jan 2025");
            }
            ctx.wizard.state.showData.release_date = text;
            message = await ctx.reply("🗣️ Enter the *Language* (e.g., English, Hindi):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        }

        if (ctx?.session?.release_date_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.release_date_edit_show_message_id).catch(console.error);
            delete ctx.session.release_date_edit_show_message_id;
        }
        ctx.session.language_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 3: Genre
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 2, "📅 Enter the *Release Date* again:", "_edit_show");

        let message;
        if (text === SKIP) {
            message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^[a-zA-Z\s,]+$/.test(text)) {
                return ctx.reply("❌ Invalid language. Use only letters. Try again:");
            }
            ctx.wizard.state.showData.language = text;
            message = await ctx.reply("🎭 Enter the *Genre* (e.g., Action, Comedy):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        }

        if (ctx?.session?.language_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.language_edit_show_message_id).catch(console.error);
            delete ctx.session.language_edit_show_message_id;
        }
        ctx.session.genre_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 4: Thumbnail URL
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text === BACK) return scense_stepBack(ctx, 3, "🗣️ Enter the *Language* again:", "_edit_show");

        let message;
        if (text === SKIP) {
            message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            if (!/^[a-zA-Z\s,]+$/.test(text)) {
                return ctx.reply("❌ Invalid genre. Use only letters. Try again:");
            }
            ctx.wizard.state.showData.thumbnail = text;
            message = await ctx.reply("🖼️ Send the *Thumbnail URL* (image link):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        }

        if (ctx?.session?.genre_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.genre_edit_show_message_id).catch(console.error);
            delete ctx.session.genre_edit_show_message_id;
        }
        ctx.session.thumbnail_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 5: Category (asks for category; actual category reply handled in Step 5)
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text && text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text && text === BACK) return scense_stepBack(ctx, 4, "🎭 Enter the *Genre* (e.g., Action, Comedy) again:", "_edit_show");

        let message;
        // If SKIP, we keep existing category and proceed (the actual handling is in Step 5)
        if (text === SKIP) {
            message = await ctx.reply(
                "🎯 Please select the *Category* of the show by sending the corresponding number (or press Skip):\n\n" +
                "1️⃣ Bollywood\n" +
                "2️⃣ Hollywood\n" +
                "3️⃣ Hollywood Dual\n" +
                "4️⃣ South Dual\n" +
                "5️⃣ Anime\n" +
                "6️⃣ Other",
                { parse_mode: "Markdown", ...keyboard }
            );
        } else {
            // treat incoming text as thumbnail (we already set thumbnail in previous step)
            // but user might send thumbnail here; validate and set if provided
            const urlRegex = /^(https?:\/\/[^\s]+)/;
            if (!urlRegex.test(text)) {
                return ctx.reply("❌ Invalid URL. Please send a valid image URL:");
            }

            ctx.wizard.state.showData.thumbnail = text;
            message = await ctx.reply(
                "🎯 Please select the *Category* of the show by sending the corresponding number (or press Skip):\n\n" +
                "1️⃣ Bollywood\n" +
                "2️⃣ Hollywood\n" +
                "3️⃣ Hollywood Dual\n" +
                "4️⃣ South Dual\n" +
                "5️⃣ Anime\n" +
                "6️⃣ Other",
                { parse_mode: "Markdown", ...keyboard }
            );
        }

        if (ctx?.session?.thumbnail_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.thumbnail_edit_show_message_id).catch(console.error);
            delete ctx.session.thumbnail_edit_show_message_id;
        }
        ctx.session.category_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 6: Download links (handles category reply first, then season selection / add)
    async (ctx) => {
        const rawText = ctx?.message?.text;
        const text = rawText ? rawText.trim() : "";

        if (text && text === '/start') return start_message(bot, ctx);
        if (text && text === CANCEL) return cancelWizard(ctx, "_edit_show");
        // BACK should go to previous step (thumbnail)
        if (text && text === BACK) return scense_stepBack(ctx, 5, "🖼️ Send the *Thumbnail URL* (image link) again:", "_edit_show");
        if (text && text === SKIP) {
            // Keep existing category, just cleanup prompt message
            try { await ctx.deleteMessage(ctx.session.category_edit_show_message_id).catch(() => { }); } catch (e) { }
            delete ctx.session.category_edit_show_message_id;

            // Ensure series array exists
            if (!ctx.wizard.state.showData.series) ctx.wizard.state.showData.series = [];
            const series = ctx.wizard.state.showData.series;

            // If there are existing seasons, allow numeric selection (1,2,...)
            if (series.length > 0) {
                let messageText = "📌 Select the season you want to update by sending the corresponding number:\n\n";
                series.forEach((_, index) => {
                    messageText += `${index + 1}️⃣ Season ${index + 1}\n`;
                });
                messageText += `\n⏭ Send a number greater than ${series.length} to add a new season\n\n(Or send ${SKIP} to skip)`;

                const message = await ctx.reply(messageText, {
                    parse_mode: "Markdown",
                    ...keyboard
                });
                ctx.session.download_link_edit_show_message_id = message.message_id;
                return ctx.wizard.next();
            }
        }

        // categories map
        const categoriesMap = {
            "1": "Bollywood",
            "2": "Hollywood",
            "3": "Hollywood Dual",
            "4": "South Dual",
            "5": "Anime",
            "6": "Other"
        };

        if (/^\d+$/.test(text) && categoriesMap[text]) {
            ctx.wizard.state.showData.category = categoriesMap[text];
            try { await ctx.deleteMessage(ctx.session.category_edit_show_message_id).catch(() => { }); } catch (e) { }
            delete ctx.session.category_edit_show_message_id;
            return ctx.wizard.next();
        }

        ctx.reply("❌ Invalid category. Send a number between 1 and 6, or send Skip.", { parse_mode: "Markdown" });
        ctx.session.category_edit_show_message_id = message.message_id;
        return;
    },

    // Step 7: Season selection & download-links prompt (split from previous combined step) ===
    async (ctx) => {
        const rawText = ctx?.message?.text;
        let text = rawText ? rawText.trim() : "";

        if (text && text === '/start') return start_message(bot, ctx);
        if (text && text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text && text === BACK) return scense_stepBack(ctx, 5, "🎯 Please select the *Category* of the show again:", "_edit_show");
        if (text === SKIP) {
            message = await ctx.reply("✅ *Season added/kept*. What would you like to do next?", {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("➕ Add Another Season", "ADD_ANOTHER_SEASON")],
                    [Markup.button.callback("✅ Complete Show Setup", "COMPLETE_SHOW_SETUP")]
                ])
            });
            ctx.wizard.selectStep(7);
            return;
        } else {
            // Ensure series array exists
            if (!ctx.wizard.state.showData.series) ctx.wizard.state.showData.series = [];
            const series = ctx.wizard.state.showData.series;

            // If there are existing seasons, allow numeric selection (1,2,...)
            if (series.length > 0) {
                // If user sent a numeric selection for season
                if (text && /^\d+$/.test(text)) {
                    const num = parseInt(text, 10);

                    // If user selects an existing season -> load it for edit
                    if (num >= 1 && num <= series.length) {
                        const idx = num - 1;
                        // clone the season to avoid accidental mutation before save
                        ctx.wizard.state.currentSeason = series[idx];
                        ctx.wizard.state.currentSeasonIndex = idx;

                        if (ctx?.session?.download_link_edit_show_message_id) {
                            await ctx.deleteMessage(ctx.session.download_link_edit_show_message_id).catch(() => { });
                            delete ctx.session.download_link_edit_show_message_id;
                        }

                        // Prepare message with existing links (HTML, no preview)
                        let existingLinksText = "";
                        if (ctx.wizard.state.currentSeason.download_link && ctx.wizard.state.currentSeason.download_link.length > 0) {
                            existingLinksText = "\n\n<b>Current Links:</b>\n" + ctx.wizard.state.currentSeason.download_link
                                .map((l, i) => `${i + 1}. ${l}`)
                                .join("\n");
                        }

                        const message = await ctx.reply(
                            `🔗 Enter <b>Download Links</b> for Season ${num} (one per line):${existingLinksText}`,
                            {
                                parse_mode: "HTML",
                                disable_web_page_preview: true,
                                ...keyboard
                            }
                        );

                        ctx.session.download_link_edit_show_message_id = message.message_id;
                        // advance to next step (qualities) where admin will input/update links
                        return ctx.wizard.next();
                    }

                    // If user sends a number greater than existing count => add new season
                    if (num > series.length) {
                        ctx.wizard.state.currentSeason = {};
                        delete ctx.wizard.state.currentSeasonIndex; // ensure no index

                        // cleanup previous prompts
                        if (ctx?.session?.download_link_edit_show_message_id) {
                            await ctx.deleteMessage(ctx.session.download_link_edit_show_message_id).catch(() => { });
                            delete ctx.session.download_link_edit_show_message_id;
                        }

                        const message = await ctx.reply("🔗 Enter *Download Links* for this new season (one per line):", {
                            parse_mode: "Markdown",
                            disable_web_page_preview: true,
                            ...keyboard
                        });

                        ctx.session.download_link_edit_show_message_id = message.message_id;
                        // advance to next step (qualities)
                        return ctx.wizard.next();
                    }
                }

                // If not a numeric selection, send the numbered list prompt (only once)
                if (!ctx?.session?.download_link_edit_show_message_id) {
                    let messageText = "📌 Select the season you want to update by sending the corresponding number:\n\n";
                    series.forEach((_, index) => {
                        messageText += `${index + 1}️⃣ Season ${index + 1}\n`;
                    });
                    messageText += `\n⏭ Send a number greater than ${series.length} to add a new season\n\n(Or send ${SKIP} to skip)`;

                    const message = await ctx.reply(messageText, {
                        parse_mode: "Markdown",
                        ...keyboard
                    });

                    ctx.session.download_link_edit_show_message_id = message.message_id;
                    return;
                } else {
                    // remind user (less spam)
                    await ctx.reply("📌 Please send the season number (e.g., `1`) to edit that season, or a larger number to add a new season.", { parse_mode: "Markdown" });
                    return;
                }
            }

            // If no existing seasons, initialize currentSeason and prompt for download links
            message = await ctx.reply("🔗 Enter *Download Links* for this season (one per line):", {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
                ...keyboard
            });

            ctx.wizard.state.currentSeason = {};
            if (!ctx?.wizard?.state?.showData?.series) {
                ctx.wizard.state.showData.series = [];
            }
        }

        if (ctx?.session?.category_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.category_edit_show_message_id).catch(() => { });
            delete ctx.session.category_edit_show_message_id;
        }
        ctx.session.download_link_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 8: Qualities (here ctx.message.text contains the download links the user sent in previous step)
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text && text === CANCEL) return cancelWizard(ctx, "_edit_show");

        if (text && text === BACK) {
            const series = ctx.wizard.state.showData.series;
            let messageText = "📌 Select the season you want to update by sending the corresponding number:\n\n";
            series.forEach((_, index) => {
                messageText += `${index + 1}️⃣ Season ${index + 1}\n`;
            });
            messageText += `\n⏭ Send a number greater than ${series.length} to add a new season\n\n(Or send ${SKIP} to skip)`;
            return scense_stepBack(ctx, 7, messageText, "_edit_show");
        }

        let message;
        if (text === SKIP) {
            // skip editing links - keep existing download_link in currentSeason (if any)
            message = await ctx.reply("🎮 Enter *Qualities* for each download link (one per line):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        } else {
            // user sent download links text -> validate and save to currentSeason.download_link
            const urlRegex = /^(https?:\/\/[^\s]+)/;
            const links = text.split("\n").map(l => l.trim()).filter(Boolean);
            const invalidLinks = links.filter(link => !urlRegex.test(link));

            if (invalidLinks.length > 0) {
                return ctx.reply("❌ Some download links are invalid URLs. Please re-enter all links:");
            }

            ctx.wizard.state.currentSeason.download_link = links;
            message = await ctx.reply("🎮 Enter *Qualities* for each download link (one per line):", {
                parse_mode: "Markdown",
                ...keyboard
            });
        }

        // cleanup previous download prompt
        if (ctx?.session?.download_link_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.download_link_edit_show_message_id).catch(console.error);
            delete ctx.session.download_link_edit_show_message_id;
        }
        ctx.session.qualities_edit_show_message_id = message.message_id;
        return ctx.wizard.next();
    },

    // Step 9: Save (here ctx.message.text contains qualities)
    async (ctx) => {
        const text = ctx.message?.text;
        if (text && text === '/start') return start_message(bot, ctx);
        if (text && text === CANCEL) return cancelWizard(ctx, "_edit_show");
        if (text && text === BACK) return scense_stepBack(ctx, 6, "🎮 Enter *Qualities* again:", "_edit_show");

        // If SKIP -> do not change qualities, just offer next actions
        if (text === SKIP) {
            await ctx.reply("✅ *Season added/kept*. What would you like to do next?", {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("➕ Add Another Season", "ADD_ANOTHER_SEASON")],
                    [Markup.button.callback("✅ Complete Show Setup", "COMPLETE_SHOW_SETUP")]
                ]).reply_markup
            });
        } else {
            // parse qualities
            const qualities = text.split("\n").map(q => q.trim()).filter(Boolean);
            const links = ctx.wizard.state.currentSeason.download_link || [];

            if (qualities.length !== links.length) {
                return ctx.reply(`⚠️ Number of qualities (${qualities.length}) must match download links (${links.length}). Please re-enter:`);
            }

            ctx.wizard.state.currentSeason.quality = qualities;

            // if editing existing season -> replace at index; else push as new season
            if (typeof ctx.wizard.state.currentSeasonIndex === 'number') {
                // update existing season
                ctx.wizard.state.showData.series[ctx.wizard.state.currentSeasonIndex] = ctx.wizard.state.currentSeason;
            } else {
                // push new season
                ctx.wizard.state.showData.series.push(ctx.wizard.state.currentSeason);
            }

            await ctx.reply("✅ *Season saved*. What would you like to do next?", {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("➕ Add Another Season", "ADD_ANOTHER_SEASON")],
                    [Markup.button.callback("✅ Complete Show Setup", "COMPLETE_SHOW_SETUP")]
                ]).reply_markup
            });
        }

        // cleanup category/session prompts
        if (ctx?.session?.category_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.category_edit_show_message_id).catch(console.error);
            delete ctx.session.category_edit_show_message_id;
        }
        if (ctx?.session?.qualities_edit_show_message_id) {
            await ctx.deleteMessage(ctx.session.qualities_edit_show_message_id).catch(console.error);
            delete ctx.session.qualities_edit_show_message_id;
        }

        return ctx.wizard.next();
    },

    // Step 10: Handle button callbacks (Add another season / Complete)
    async (ctx) => {
        const data = ctx.callbackQuery?.data;
        if (!data) return;

        await ctx.answerCbQuery(); // acknowledge

        if (data === "ADD_ANOTHER_SEASON") {
            // reset currentSeason and index, jump to download links step
            ctx.wizard.state.currentSeason = {};
            delete ctx.wizard.state.currentSeasonIndex;
            await ctx.editMessageText("🔗 Enter *Download Links* for this season (one per line):", {
                parse_mode: "Markdown",
                reply_markup: Markup.inlineKeyboard([])
            }).catch(() => { });
            return ctx.wizard.selectStep(5);
        }

        if (data === "COMPLETE_SHOW_SETUP") {
            try {
                await shows_module.findByIdAndUpdate(ctx.session.showId, ctx.wizard.state.showData);
                let message = await ctx.reply("✅ Show updated successfully!", Markup.removeKeyboard());
                setTimeout(async () => {
                    await ctx.deleteMessage(message.message_id).catch(() => { });
                    await menu_btn_admin(ctx);
                }, 3000);

                if (ctx.session.editMessageId) {
                    try {
                        await ctx.deleteMessage(ctx.session.editMessageId);
                    } catch (err) {
                        console.error("❌ Failed to delete message:", err.message);
                    }
                }

                return ctx.scene.leave();
            } catch (error) {
                console.error("❌ Error saving show:", error);
                return ctx.reply("⚠️ Failed to save the show. Please try again later.");
            }
        }
    }
);

module.exports = updateShowWizard;
