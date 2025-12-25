// set_regulation.js

const { Markup } = require("telegraf");

const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");

module.exports = (bot) => {
    // -------------------------------
    // Helpers
    // -------------------------------

    function buildInlineKeyboardFromSavedButtons(buttonsData) {
        const inlineKeyboard = [];

        if (!Array.isArray(buttonsData) || !buttonsData.length) return inlineKeyboard;

        // Iterate row by row
        buttonsData.forEach((row) => {
            const rowButtons = [];
            if (!Array.isArray(row)) return;

            row.forEach((btn) => {
                if (!btn?.text || !btn?.content) return;

                const content = String(btn.content).trim();

                // URL-like
                if (/^(https?:\/\/|t\.me\/|@|[a-z0-9\-]+\.[a-z]{2,})/i.test(content)) {
                    let link = content.trim();

                    if (link.startsWith("@")) {
                        link = `https://t.me/${link.slice(1)}`;
                    } else if (link.startsWith("t.me/")) {
                        link = `https://${link}`;
                    } else if (!/^https?:\/\//i.test(link)) {
                        link = `https://${link}`;
                    }

                    rowButtons.push(Markup.button.url(btn.text, link));
                    return;
                }

                // Custom actions (callback)
                if (content.startsWith("popup:")) {
                    const encodedContent = Buffer.from(btn.content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `POPUP_${encodedContent}`));
                    return;
                }

                if (content.startsWith("alert:")) {
                    const encoded = Buffer.from(content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `ALERT_${encoded}`));
                    return;
                }

                if (content.startsWith("share:")) {
                    const shareText = content.replace(/^share:/, "").trim();
                    rowButtons.push(Markup.button.switchToChat(btn.text, shareText));
                    return;
                }

                if (content.startsWith("copy:")) {
                    const copyText = content.replace(/^copy:/, "").trim();
                    const encoded = Buffer.from(copyText, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `COPYTXT_${encoded}`));
                    return;
                }

                if (content === "del") {
                    const encoded = Buffer.from(content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `DEL_${encoded}`));
                    return;
                }

                if (content.startsWith("personal:")) {
                    const command = content.replace(/^personal:/, "").trim();
                    const encoded = Buffer.from(command, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `PERSONAL_${encoded}`));
                    return;
                }

                // fallback
                const encoded = Buffer.from(content, "utf8").toString("base64");
                rowButtons.push(Markup.button.callback(btn.text, `GENERIC_${encoded}`));
            });

            if (rowButtons.length) inlineKeyboard.push(rowButtons);
        });

        return inlineKeyboard;
    }

    async function sendRegulationToChat(ctx, chatIdStr, reg) {
        const inlineKeyboard = buildInlineKeyboardFromSavedButtons(reg?.buttons);

        const replyMarkup = inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined;

        // Media preferred
        if (reg?.media && reg?.media_type) {
            try {
                if (reg.media_type === "photo") {
                    await ctx.replyWithPhoto(reg.media, {
                        caption: reg.text || "",
                        parse_mode: "HTML",
                        reply_markup: replyMarkup,
                    });
                    return;
                }

                if (reg.media_type === "video") {
                    await ctx.replyWithVideo(reg.media, {
                        caption: reg.text || "",
                        parse_mode: "HTML",
                        reply_markup: replyMarkup,
                    });
                    return;
                }

                // document fallback
                await ctx.replyWithDocument(reg.media, {
                    caption: reg.text || "",
                    parse_mode: "HTML",
                    reply_markup: replyMarkup,
                });
                return;
            } catch (e) {
                // If media send fails, fallback to text
            }
        }

        // Text fallback
        const textToSend = (reg?.text || "").trim();
        if (textToSend) {
            await ctx.reply(textToSend, {
                parse_mode: "HTML",
                reply_markup: replyMarkup,
            });
            return;
        }

        // If nothing to send
        await ctx.reply("❌ No rules content found for this group. Ask an admin to set it from the bot menu.");
    }

    // -------------------------------
    // NEW: /rules listener (GROUP)
    // -------------------------------
    bot.command("rules", async (ctx) => {
        try {
            const chatType = ctx.chat?.type;
            if (chatType !== "group" && chatType !== "supergroup") return;

            const chatIdStr = String(ctx.chat.id);

            // Find any user doc which has this group rules enabled (ownership model should ensure single doc)
            const doc = await user_setting_module
                .findOne(
                    { [`settings.${chatIdStr}.setregulation_message.enabled`]: true },
                    { [`settings.${chatIdStr}.setregulation_message`]: 1 }
                )
                .lean();

            const reg = doc?.settings?.[chatIdStr]?.setregulation_message;

            if (!reg?.enabled) return;

            const hasText = !!(reg.text && String(reg.text).trim());
            const hasMedia = !!reg.media;
            const hasButtons = Array.isArray(reg.buttons) && reg.buttons.length > 0;

            if (!hasText && !hasMedia && !hasButtons) return;

            await sendRegulationToChat(ctx, chatIdStr, reg);
        } catch (err) {
            console.error("❌ /rules listener error:", err);
        }
    });

    // -------------------------------
    // MAIN SET REGULATION MENU
    // -------------------------------
    bot.action(/SET_REGULATION_(.+)/, async (ctx) => {
        ctx.session = {};

        const userId = ctx.from.id;
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message || {};
        const enabled = !!reg.enabled;

        const statusLabel = enabled ? "On ✅" : "Off ❌";

        let textMsg =
            `📜 Group's regulations\n\n` +
            `From this menu you can manage the group's regulations, that will be shown with the command /rules.\n\n` +
            `Current status: ${statusLabel}\n\n` +
            `👉 Use the buttons below to manage the regulation for ${chat.title || chatIdStr}.`;

        const buttons = [
            [
                Markup.button.callback("✅ Turn On", `TURN_ON_REG_${chatIdStr}`),
                Markup.button.callback("❌ Turn Off", `TURN_OFF_REG_${chatIdStr}`),
            ],
            [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
            [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)],
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons),
        });
    });

    // -------------------------------
    // TURN ON
    // -------------------------------
    bot.action(/TURN_ON_REG_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message || {};

            const hasText = !!(reg.text && reg.text.trim());
            const hasMedia = !!reg.media;
            const hasButtons = Array.isArray(reg.buttons) && reg.buttons.length > 0;

            // if nothing set, do NOT enable — open customize
            if (!hasText && !hasMedia && !hasButtons) {
                const ok = "✅";
                const no = "❌";
                const textMsg =
                    `📜 Regulation\n\n` +
                    `Use the buttons below to choose what you want to set\n\n` +
                    `Current status:\n` +
                    ` ${hasText ? ok : no} 📄 Text\n` +
                    ` ${hasMedia ? ok : no} 📸 Media\n` +
                    ` ${hasButtons ? ok : no} 🔠 Url Buttons\n\n` +
                    `👉 Use the buttons below to edit or preview the regulation.`;

                const buttons = [
                    [
                        Markup.button.callback("📄 Text", `SET_REG_RULES_TEXT_${chatIdStr}`),
                        Markup.button.callback(
                            hasText ? "👀 See" : "➕ Add",
                            hasText ? `SEE_REG_RULES_TEXT_${chatIdStr}` : `SET_REG_RULES_TEXT_${chatIdStr}`
                        ),
                    ],
                    [
                        Markup.button.callback("📸 Media", `SET_REG_RULES_MEDIA_${chatIdStr}`),
                        Markup.button.callback(
                            hasMedia ? "👀 See" : "➕ Add",
                            hasMedia ? `SEE_REG_RULES_MEDIA_${chatIdStr}` : `SET_REG_RULES_MEDIA_${chatIdStr}`
                        ),
                    ],
                    [
                        Markup.button.callback("🔠 Url Buttons", `SET_REG_RULES_BUTTONS_${chatIdStr}`),
                        Markup.button.callback(
                            hasButtons ? "👀 See" : "➕ Add",
                            hasButtons ? `SEE_REG_RULES_BUTTONS_${chatIdStr}` : `SET_REG_RULES_BUTTONS_${chatIdStr}`
                        ),
                    ],
                    [Markup.button.callback("👀 Full preview", `PREVIEW_REGULATION_${chatIdStr}`)],
                    [
                        Markup.button.callback("⬅️ Back", `SET_REGULATION_${chatIdStr}`),
                        Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`),
                    ],
                ];

                ctx.session = {};
                const message_id = await safeEditOrSend(
                    ctx,
                    textMsg,
                    { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) },
                    true
                );
                ctx.session.set_regulation_message_id = message_id;
                return;
            }

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: true } },
                { upsert: true }
            );

            await ctx.answerCbQuery("✅ Regulation turned ON", { show_alert: false });

            const textMsg =
                `📜 Group's regulations\n\n` +
                `From this menu you can manage the group's regulations, that will be shown with the command /rules.\n\n` +
                `Current status: On ✅\n\n` +
                `👉 Use the buttons below to manage the regulation for ${chat.title || chatIdStr}.`;

            const buttons = [
                [
                    Markup.button.callback("✅ Turn On", `TURN_ON_REG_${chatIdStr}`),
                    Markup.button.callback("❌ Turn Off", `TURN_OFF_REG_${chatIdStr}`),
                ],
                [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)],
            ];

            await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons),
            });
        } catch (err) {
            console.error("Error turning ON regulation:", err);
            try {
                await ctx.reply("⚠️ Could not turn ON regulation. Please try again.");
            } catch { }
        }
    });

    // -------------------------------
    // TURN OFF
    // -------------------------------
    bot.action(/TURN_OFF_REG_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } },
                { upsert: true }
            );

            await ctx.answerCbQuery("✅ Regulation turned OFF", { show_alert: false });

            const textMsg =
                `📜 Group's regulations\n\n` +
                `From this menu you can manage the group's regulations, that will be shown with the command /rules.\n\n` +
                `Current status: Off ❌\n\n` +
                `👉 Use the buttons below to manage the regulation for ${chat.title || chatIdStr}.`;

            const buttons = [
                [
                    Markup.button.callback("✅ Turn On", `TURN_ON_REG_${chatIdStr}`),
                    Markup.button.callback("❌ Turn Off", `TURN_OFF_REG_${chatIdStr}`),
                ],
                [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)],
            ];

            await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons),
            });
        } catch (err) {
            console.error("Error turning OFF regulation:", err);
            try {
                await ctx.reply("⚠️ Could not turn OFF regulation. Please try again.");
            } catch { }
        }
    });

    // -------------------------------
    // CUSTOMIZE RULES
    // -------------------------------
    bot.action(/^CUSTOMIZE_RULES_(.+)$/, async (ctx) => {
        try {
            ctx.session = {};

            const userId = ctx.from.id;
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message || {};

            const hasText = !!(reg.text && reg.text.trim());
            const hasMedia = !!reg.media;
            const hasButtons = Array.isArray(reg.buttons) && reg.buttons.length > 0;

            const ok = "✅";
            const no = "❌";

            const textMsg =
                `📜 Regulation\n\n` +
                `Use the buttons below to choose what you want to set\n\n` +
                `Current status:\n` +
                ` ${hasText ? ok : no} 📄 Text\n` +
                ` ${hasMedia ? ok : no} 📸 Media\n` +
                ` ${hasButtons ? ok : no} 🔠 Url Buttons\n\n` +
                `👉 Use the buttons below to edit or preview the regulation.`;

            const buttons = [
                [
                    Markup.button.callback("📄 Text", `SET_REG_RULES_TEXT_${chatIdStr}`),
                    Markup.button.callback(
                        hasText ? "👀 See" : "➕ Add",
                        hasText ? `SEE_REG_RULES_TEXT_${chatIdStr}` : `SET_REG_RULES_TEXT_${chatIdStr}`
                    ),
                ],
                [
                    Markup.button.callback("📸 Media", `SET_REG_RULES_MEDIA_${chatIdStr}`),
                    Markup.button.callback(
                        hasMedia ? "👀 See" : "➕ Add",
                        hasMedia ? `SEE_REG_RULES_MEDIA_${chatIdStr}` : `SET_REG_RULES_MEDIA_${chatIdStr}`
                    ),
                ],
                [
                    Markup.button.callback("🔠 Url Buttons", `SET_REG_RULES_BUTTONS_${chatIdStr}`),
                    Markup.button.callback(
                        hasButtons ? "👀 See" : "➕ Add",
                        hasButtons ? `SEE_REG_RULES_BUTTONS_${chatIdStr}` : `SET_REG_RULES_BUTTONS_${chatIdStr}`
                    ),
                ],
                [Markup.button.callback("👀 Full preview", `PREVIEW_REGULATION_${chatIdStr}`)],
                [
                    Markup.button.callback("⬅️ Back", `SET_REGULATION_${chatIdStr}`),
                    Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`),
                ],
            ];

            const message_id = await safeEditOrSend(
                ctx,
                textMsg,
                { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) },
                true
            );

            ctx.session = ctx.session || {};
            ctx.session.set_regulation_message_id = message_id;
        } catch (err) {
            console.error("❌ Error in CUSTOMIZE_RULES handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while opening regulation editor. Please try again.");
            } catch { }
        }
    });

    // -------------------------------
    // TEXT SETTING
    // -------------------------------
    bot.action(/SET_REG_RULES_TEXT_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        // Node (when generating link)
        const payload = `${process.env.GROUP_HELP_ADVANCE_TOKEN}:group-help-advance:text-message-design`;
        const encoded = encodeURIComponent(Buffer.from(payload).toString('base64'));
        const miniAppLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encoded}`;

        const textMsg =
            "👉🏻 Send the message you want to set.\n\n" +
            "To see what you can do with message design (placeholders and HTML), " +
            `<a href="${miniAppLink}">Click Here</a>.`;

        const buttons = [
            [Markup.button.callback("🚫 Remove message", `REMOVE_REG_RULES_TEXT_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)],
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons),
            disable_web_page_preview: true
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingTextRegulation = { chatIdStr, userId };
    });

    // -------------------------------
    // MEDIA SETTING
    // -------------------------------
    bot.action(/SET_REG_RULES_MEDIA_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const textMsg = "👉🏻 Send now the media (photos, videos, audio, stickers...) you want to set.";

        const buttons = [
            [Markup.button.callback("🚫 Remove message", `REMOVE_REG_RULES_MEDIA_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)],
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons),
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingMediaRegulation = { chatIdStr, userId };
    });

    // -------------------------------
    // URL BUTTONS SETTING
    // -------------------------------
    bot.action(/SET_REG_RULES_BUTTONS_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const builderUrl = process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE;

        const textMsg =
            `👉🏻 Send now the Buttons you want to set.\n\n` +
            `If you need a visual tool to build the buttons and get the exact code, Click Here.\n\n`;

        const buttons = [
            [Markup.button.callback("🚫 Remove Keyboard", `REMOVE_REG_RULES_BUTTONS_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)],
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons),
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingButtonsRegulation = { chatIdStr, userId, builderUrl };
    });

    // -------------------------------
    // HANDLE INCOMING TEXT SAVE
    // -------------------------------
    bot.on("text", async (ctx, next) => {
        try {
            // TEXT REGULATION
            if (ctx.session?.awaitingTextRegulation) {
                const { chatIdStr, userId } = ctx.session.awaitingTextRegulation;
                const text = ctx.message.text;

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingTextRegulation;
                    return;
                }

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.text`]: text } },
                    { upsert: true }
                );

                const successMsg =
                    `✅ Text regulation saved for ${chat.title || chatIdStr}.\n\n` +
                    `Note: This does not enable the regulation. Use the Turn On button to activate it.`;

                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)],
                ];

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });

                if (ctx?.session?.set_regulation_message_id) {
                    try {
                        await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                    } catch { }
                    delete ctx.session.set_regulation_message_id;
                }

                delete ctx.session.awaitingTextRegulation;
                return;
            }

            // URL BUTTONS REGULATION
            if (ctx.session?.awaitingButtonsRegulation) {
                const { chatIdStr, userId } = ctx.session.awaitingButtonsRegulation;
                const raw = (ctx.message.text || "").trim();

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingButtonsRegulation;
                    return;
                }

                const res = await parseButtonsSyntax(ctx, raw);
                if (!res.match) {
                    try {
                        await ctx.reply("❌ Buttons syntax not recognized. Make sure you follow the examples or use the button builder link.");
                    } catch { }
                    delete ctx.session.awaitingButtonsRegulation;
                    return;
                }

                const parsedButtons = res.buttons;

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.buttons`]: parsedButtons } },
                    { upsert: true }
                );

                const successMsg =
                    `✅ Url Buttons saved for ${chat.title || chatIdStr}.\n\n` +
                    `Note: This does not enable the regulation. Use the Turn On button to activate it.`;

                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)],
                ];

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });

                if (ctx?.session?.set_regulation_message_id) {
                    try {
                        await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                    } catch { }
                    delete ctx.session.set_regulation_message_id;
                }

                delete ctx.session.awaitingButtonsRegulation;
                return;
            }
        } catch (err) {
            console.error("❌ Error in incoming text handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while saving. Please try again.");
            } catch { }
            if (ctx.session?.awaitingTextRegulation) delete ctx.session.awaitingTextRegulation;
            if (ctx.session?.awaitingButtonsRegulation) delete ctx.session.awaitingButtonsRegulation;
        }

        if (typeof next === "function") await next();
    });

    // -------------------------------
    // HANDLE INCOMING MEDIA SAVE
    // -------------------------------
    bot.on(["photo", "video", "document"], async (ctx, next) => {
        try {
            if (!ctx.session || !ctx.session.awaitingMediaRegulation) {
                if (typeof next === "function") await next();
                return;
            }

            const { chatIdStr, userId } = ctx.session.awaitingMediaRegulation;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                delete ctx.session.awaitingMediaRegulation;
                return;
            }

            let fileId = null;
            let mediaType = null;

            if (ctx.message.photo) {
                fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                mediaType = "photo";
            } else if (ctx.message.video) {
                fileId = ctx.message.video.file_id;
                mediaType = "video";
            } else if (ctx.message.document) {
                fileId = ctx.message.document.file_id;
                mediaType = "document";
            }

            if (!fileId || !mediaType) {
                delete ctx.session.awaitingMediaRegulation;
                return;
            }

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.setregulation_message.media`]: fileId,
                        [`settings.${chatIdStr}.setregulation_message.media_type`]: mediaType,
                    },
                },
                { upsert: true }
            );

            const successCaption =
                `✅ Media regulation saved for ${chat.title || chatIdStr}.\n\n` +
                `Note: This does not enable the regulation. Use the Turn On button to activate it.`;

            const buttons = [
                [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)],
            ];

            await ctx.reply(successCaption, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });

            if (ctx?.session?.set_regulation_message_id) {
                try {
                    await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                } catch { }
                delete ctx.session.set_regulation_message_id;
            }

            delete ctx.session.awaitingMediaRegulation;
        } catch (err) {
            console.error("❌ Error in incoming media handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while saving the media. Please try again.");
            } catch { }
            if (ctx.session?.awaitingMediaRegulation) delete ctx.session.awaitingMediaRegulation;
        }

        if (typeof next === "function") await next();
    });

    // -------------------------------
    // SEE TEXT
    // -------------------------------
    bot.action(/SEE_REG_RULES_TEXT_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const text = userDoc?.settings?.[chatIdStr]?.setregulation_message?.text;

            if (!text) {
                return ctx.answerCbQuery("❌ No text set yet!", { show_alert: true });
            }

            await ctx.reply(text, { parse_mode: "HTML" });
        } catch (e) {
            console.error("SEE_REG_RULES_TEXT error:", e);
        }
    });

    // -------------------------------
    // SEE MEDIA
    // -------------------------------
    bot.action(/SEE_REG_RULES_MEDIA_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message;

            if (!reg?.media || !reg?.media_type) {
                return ctx.answerCbQuery("❌ No media set yet!", { show_alert: true });
            }

            let sentMsg;
            if (reg.media_type === "photo") {
                sentMsg = await ctx.replyWithPhoto(reg.media);
            } else if (reg.media_type === "video") {
                sentMsg = await ctx.replyWithVideo(reg.media);
            } else {
                sentMsg = await ctx.replyWithDocument(reg.media);
            }

            ctx.session = ctx.session || {};
            ctx.session.set_regulation_message_id = sentMsg?.message_id;
        } catch (e) {
            console.error("SEE_REG_RULES_MEDIA error:", e);
        }
    });

    // -------------------------------
    // SEE BUTTONS (renders keyboard)
    // -------------------------------
    bot.action(/SEE_REG_RULES_BUTTONS_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const buttonsData = userDoc?.settings?.[chatIdStr]?.setregulation_message?.buttons;

            if (!buttonsData || buttonsData.length === 0) {
                return ctx.answerCbQuery("❌ No buttons set yet!", { show_alert: true });
            }

            const inlineKeyboard = buildInlineKeyboardFromSavedButtons(buttonsData);

            inlineKeyboard.push([
                Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`),
            ]);

            await safeEditOrSend(ctx, "🔠 Saved Buttons:", {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: inlineKeyboard },
            });
        } catch (e) {
            console.error("SEE_REG_RULES_BUTTONS error:", e);
        }
    });

    // -------------------------------
    // COPYTXT handler
    // -------------------------------
    bot.action(/COPYTXT_(.+)/, async (ctx) => {
        try {
            const encoded = ctx.match[1];
            const decoded = Buffer.from(encoded, "base64").toString("utf8");
            await ctx.answerCbQuery("Copied text will be sent to you.", { show_alert: false });
            await ctx.reply(`Here is the text to copy:\n\n${decoded}`);
        } catch (err) {
            console.error("Error in COPYTXT handler:", err);
            try {
                await ctx.answerCbQuery("❌ Could not retrieve the text.", { show_alert: true });
            } catch { }
        }
    });

    // -------------------------------
    // FULL PREVIEW (admin panel)
    // -------------------------------
    bot.action(/PREVIEW_REGULATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message;

            if (!reg) {
                return ctx.answerCbQuery("❌ No regulation saved! Turn it ON to preview.", { show_alert: true });
            }

            await sendRegulationToChat(ctx, chatIdStr, reg);
        } catch (e) {
            console.error("PREVIEW_REGULATION error:", e);
        }
    });

    // -------------------------------
    // REMOVE TEXT
    // -------------------------------
    bot.action(/REMOVE_REG_RULES_TEXT_(.+)/, async (ctx) => {
        try {
            ctx.session = {};

            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.setregulation_message.text`]: "" } },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = refreshed?.settings?.[chatIdStr]?.setregulation_message || {};
            const stillHasSomething = !!(reg.text || reg.media || (Array.isArray(reg.buttons) && reg.buttons.length));

            if (!stillHasSomething) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ Text removed for chat ${chat.title || chatIdStr}.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)],
                ]),
            });
        } catch (e) {
            console.error("REMOVE_REG_RULES_TEXT error:", e);
            try {
                await ctx.reply("⚠️ Something went wrong while removing the text. Try again.");
            } catch { }
        }
    });

    // -------------------------------
    // REMOVE MEDIA
    // -------------------------------
    bot.action(/REMOVE_REG_RULES_MEDIA_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.setregulation_message.media`]: "",
                        [`settings.${chatIdStr}.setregulation_message.media_type`]: "",
                    },
                },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = refreshed?.settings?.[chatIdStr]?.setregulation_message || {};
            const stillHasSomething = !!(reg.text || reg.media || (Array.isArray(reg.buttons) && reg.buttons.length));

            if (!stillHasSomething) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ Media removed for chat ${chat.title || chatIdStr}.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)],
                ]),
            });
        } catch (e) {
            console.error("REMOVE_REG_RULES_MEDIA error:", e);
            try {
                await ctx.reply("⚠️ Something went wrong while removing the media. Try again.");
            } catch { }
        }
    });

    // -------------------------------
    // REMOVE BUTTONS
    // -------------------------------
    bot.action(/REMOVE_REG_RULES_BUTTONS_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.setregulation_message.buttons`]: "" } },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = refreshed?.settings?.[chatIdStr]?.setregulation_message || {};
            const stillHasSomething = !!(reg.text || reg.media || (Array.isArray(reg.buttons) && reg.buttons.length));

            if (!stillHasSomething) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ Url buttons removed for chat ${chat.title || chatIdStr}.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)],
                ]),
            });
        } catch (e) {
            console.error("REMOVE_REG_RULES_BUTTONS error:", e);
            try {
                await ctx.reply("⚠️ Something went wrong while removing the buttons. Try again.");
            } catch { }
        }
    });
};
