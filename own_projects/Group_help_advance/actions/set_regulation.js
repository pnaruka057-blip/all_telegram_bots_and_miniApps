// regulation.js
const { Markup, session } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");

module.exports = (bot) => {
    // ====== MAIN SET REGULATION MENU ======
    bot.action(/SET_REGULATION_(.+)/, async (ctx) => {
        ctx.session = {};
        const userId = ctx.from.id;
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        // fetch user's saved regulation enabled state
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message || {};
        const enabled = !!reg.enabled;

        const statusLabel = enabled ? "On ✅" : "Off ❌";

        let textMsg = `📜 <b>Group's regulations</b>\n\nFrom this menu you can manage the group's regulations, that will be shown with the command /rules.\n\n<b>Current status</b>: ${statusLabel}`;

        // NOTE: two separate buttons (Turn On / Turn Off) as requested
        const buttons = [
            [
                Markup.button.callback("✅ Turn On", `TURN_ON_REG_${chatIdStr}`),
                Markup.button.callback("❌ Turn Off", `TURN_OFF_REG_${chatIdStr}`)
            ],
            [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
            [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
        ];

        textMsg += `\n\n<i>👉 Use the buttons below to manage the regulation for <b>${chat.title || chatIdStr}</b>.</i>`;

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });

    // ===== TURN ON =====
    bot.action(/TURN_ON_REG_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            // fetch current saved regulation content for this chat
            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message || {};

            const hasText = !!(reg.text && reg.text.trim());
            const hasMedia = !!reg.media;
            const hasButtons = Array.isArray(reg.buttons) && reg.buttons.length > 0;

            // if nothing set, do NOT enable — open the CUSTOMIZE_RULES view automatically
            if (!hasText && !hasMedia && !hasButtons) {

                // Build the same menu as CUSTOMIZE_RULES handler so user sees editor immediately
                const ok = "✅";
                const no = "❌";

                const textMsg =
                    `📜 <b>Regulation</b>\n\n` +
                    `Use the buttons below to choose what you want to set\n\n` +
                    `<b>Current status:</b>\n` +
                    ` ${hasText ? ok : no} 📄 Text\n` +
                    ` ${hasMedia ? ok : no} 📸 Media\n` +
                    ` ${hasButtons ? ok : no} 🔠 Url Buttons\n\n` +
                    `<i>👉 Use the buttons below to edit or preview the regulation.</i>`;

                const buttons = [
                    [
                        Markup.button.callback("📄 Text", `SET_REG_RULES_TEXT_${chatIdStr}`),
                        Markup.button.callback(hasText ? "👀 See" : "➕ Add", hasText ? `SEE_REG_RULES_TEXT_${chatIdStr}` : `SET_REG_RULES_TEXT_${chatIdStr}`)
                    ],
                    [
                        Markup.button.callback("📸 Media", `SET_REG_RULES_MEDIA_${chatIdStr}`),
                        Markup.button.callback(hasMedia ? "👀 See" : "➕ Add", hasMedia ? `SEE_REG_RULES_MEDIA_${chatIdStr}` : `SET_REG_RULES_MEDIA_${chatIdStr}`)
                    ],
                    [
                        Markup.button.callback("🔠 Url Buttons", `SET_REG_RULES_BUTTONS_${chatIdStr}`),
                        Markup.button.callback(hasButtons ? "👀 See" : "➕ Add", hasButtons ? `SEE_REG_RULES_BUTTONS_${chatIdStr}` : `SET_REG_RULES_BUTTONS_${chatIdStr}`)
                    ],
                    [Markup.button.callback("👀 Full preview", `PREVIEW_REGULATION_${chatIdStr}`)],
                    [
                        Markup.button.callback("⬅️ Back", `SET_REGULATION_${chatIdStr}`),
                        Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                    ]
                ];

                // ensure session exists and clear any previous preview id to avoid safeEditOrSend editing old message
                ctx.session = {};

                const message_id = await safeEditOrSend(ctx, textMsg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard(buttons)
                }, true);

                ctx.session.set_regulation_message_id = message_id;
                return;
            }

            // if we reach here, there's at least one content type — enable regulation
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: true } },
                { upsert: true }
            );

            await ctx.answerCbQuery("✅ Regulation turned ON", { show_alert: false });

            // refresh the menu to reflect new state
            const textMsg = `📜 <b>Group's regulations</b>\n\nFrom this menu you can manage the group's regulations, that will be shown with the command /rules.\n\nCurrent status: <b>On ✅</b>\n\n<i>👉 Use the buttons below to manage the regulation for <b>${chat.title || chatIdStr}</b>.</i>`;
            const buttons = [
                [
                    Markup.button.callback("✅ Turn On", `TURN_ON_REG_${chatIdStr}`),
                    Markup.button.callback("❌ Turn Off", `TURN_OFF_REG_${chatIdStr}`)
                ],
                [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
            ];
            await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (err) {
            console.error("Error turning ON regulation:", err);
            await ctx.reply("⚠️ Could not turn ON regulation. Please try again.");
        }
    });

    // ===== TURN OFF =====
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

            // refresh the menu to reflect new state
            const textMsg = `📜 <b>Group's regulations</b>\n\nFrom this menu you can manage the group's regulations, that will be shown with the command /rules.\n\nCurrent status: <b>Off ❌</b>\n\n<i>👉 Use the buttons below to manage the regulation for <b>${chat.title || chatIdStr}</b>.</i>`;
            const buttons = [
                [
                    Markup.button.callback("✅ Turn On", `TURN_ON_REG_${chatIdStr}`),
                    Markup.button.callback("❌ Turn Off", `TURN_OFF_REG_${chatIdStr}`)
                ],
                [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
            ];
            await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            });
        } catch (err) {
            console.error("Error turning OFF regulation:", err);
            await ctx.reply("⚠️ Could not turn OFF regulation. Please try again.");
        }
    });

    // ====== CUSTOMIZE RULES ======
    bot.action(/^CUSTOMIZE_RULES_(.+)$/, async (ctx) => {
        try {
            ctx.session = {};
            const userId = ctx.from.id;
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const chatSettings = (userDoc && userDoc.settings && userDoc.settings[chatIdStr]) || {};
            const reg = chatSettings.setregulation_message || {};

            const hasText = !!(reg.text && reg.text.trim());
            const hasMedia = !!reg.media;
            const hasButtons = Array.isArray(reg.buttons) && reg.buttons.length > 0;

            const ok = "✅";
            const no = "❌";

            const textMsg =
                `📜 <b>Regulation</b>\n\n` +
                `Use the buttons below to choose what you want to set\n\n` +
                `<b>Current status:</b>\n` +
                ` ${hasText ? ok : no} 📄 Text\n` +
                ` ${hasMedia ? ok : no} 📸 Media\n` +
                ` ${hasButtons ? ok : no} 🔠 Url Buttons\n\n` +
                `<i>👉 Use the buttons below to edit or preview the regulation.</i>`;

            const buttons = [
                [
                    Markup.button.callback("📄 Text", `SET_REG_RULES_TEXT_${chatIdStr}`),
                    Markup.button.callback(hasText ? "👀 See" : "➕ Add", hasText ? `SEE_REG_RULES_TEXT_${chatIdStr}` : `SET_REG_RULES_TEXT_${chatIdStr}`)
                ],
                [
                    Markup.button.callback("📸 Media", `SET_REG_RULES_MEDIA_${chatIdStr}`),
                    Markup.button.callback(hasMedia ? "👀 See" : "➕ Add", hasMedia ? `SEE_REG_RULES_MEDIA_${chatIdStr}` : `SET_REG_RULES_MEDIA_${chatIdStr}`)
                ],
                [
                    Markup.button.callback("🔠 Url Buttons", `SET_REG_RULES_BUTTONS_${chatIdStr}`),
                    Markup.button.callback(hasButtons ? "👀 See" : "➕ Add", hasButtons ? `SEE_REG_RULES_BUTTONS_${chatIdStr}` : `SET_REG_RULES_BUTTONS_${chatIdStr}`)
                ],
                [Markup.button.callback("👀 Full preview", `PREVIEW_REGULATION_${chatIdStr}`)],
                [
                    Markup.button.callback("⬅️ Back", `SET_REGULATION_${chatIdStr}`),
                    Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                ]
            ];

            const message_id = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            }, true);

            // ensure session exists
            ctx.session = ctx.session || {};
            ctx.session.set_regulation_message_id = message_id;
        } catch (err) {
            console.error("❌ Error in CUSTOMIZE_RULES handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while opening regulation editor. Please try again.");
            } catch { }
        }
    });

    // ===== TEXT SETTING =====
    bot.action(/SET_REG_RULES_TEXT_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const textMsg =
            "👉🏻 <b>Send the message you want to set.</b>\n\n" +
            `To see what you can do with message design (placeholders and HTML), <a href="${process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE}/text-message-design">Click Here</a>.`;

        const buttons = [
            [Markup.button.callback("🚫 Remove message", `REMOVE_REG_RULES_TEXT_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)]
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingTextRegulation = { chatIdStr, userId };
    });

    // ===== MEDIA SETTING =====
    bot.action(/SET_REG_RULES_MEDIA_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const textMsg =
            "👉🏻 <b>Send now the media</b> (photos, videos, audio, stickers...) you want to set."

        const buttons = [
            [Markup.button.callback("🚫 Remove message", `REMOVE_REG_RULES_MEDIA_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)]
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingMediaRegulation = { chatIdStr, userId };
    });

    // ===== URL BUTTONS SETTING =====
    bot.action(/SET_REG_RULES_BUTTONS_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        // Provide explanation + link to a button-builder website
        const builderUrl = process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE; // replace with your real tool if available
        const textMsg =
            `👉🏻 <b>Send now the Buttons</b> you want to set.\n\n` +
            `If you need a visual tool to build the buttons and get the exact code, <a href="${builderUrl}/buttons-design">Click Here</a>.\n\n`

        const buttons = [
            [Markup.button.callback("🚫 Remove Keyboard", `REMOVE_REG_RULES_BUTTONS_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)]
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingButtonsRegulation = { chatIdStr, userId };
    });

    // ===== HANDLE INCOMING TEXT SAVE =====
    bot.on("text", async (ctx, next) => {
        try {
            // ===== TEXT REGULATION =====
            if (ctx.session?.awaitingTextRegulation) {
                let { chatIdStr, userId } = ctx.session.awaitingTextRegulation;
                const text = ctx.message.text;

                // validate owner (this also returns chat info)
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    // validation failed or user not owner — stop and clear session
                    delete ctx.session.awaitingTextRegulation;
                    return;
                }

                // save text into DB
                // NOTE: do NOT set enabled true automatically — user must toggle ON explicitly
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.setregulation_message.text`]: text
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Text regulation saved</b> for <b>${chat.title || chatIdStr}</b>.\n\n<i>Note: This does not enable the regulation. Use the Turn On button to activate it.</i>`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard(buttons)
                });

                if (ctx?.session?.set_regulation_message_id) {
                    try {
                        await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                        delete ctx.session.set_regulation_message_id
                    } catch (e) {
                        console.log("Message delete error:", e.message); // ignore error
                    }
                }

                delete ctx.session.awaitingTextRegulation;
                return;
            }

            // ===== URL BUTTONS REGULATION =====
            if (ctx.session?.awaitingButtonsRegulation) {
                let { chatIdStr, userId } = ctx.session.awaitingButtonsRegulation;
                const raw = (ctx.message.text || "").trim();

                // validate owner (also provides chat.title)
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingButtonsRegulation;
                    return;
                }

                const res = await parseButtonsSyntax(ctx, raw);

                if (!res.match) {
                    // parse failed — keep user informed
                    await ctx.reply("❌ Buttons syntax not recognized. Make sure you follow the examples or use the button builder link.");
                    delete ctx.session.awaitingButtonsRegulation;
                    return;
                }

                const parsedButtons = res.buttons;

                // Save to DB exactly in the requested format
                // NOTE: do NOT set enabled true automatically
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.setregulation_message.buttons`]: parsedButtons
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Url Buttons saved</b> for <b>${chat.title || chatIdStr}</b>.\n\n<i>Note: This does not enable the regulation. Use the Turn On button to activate it.</i>`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard(buttons)
                });

                if (ctx?.session?.set_regulation_message_id) {
                    try {
                        await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                        delete ctx.session.set_regulation_message_id
                    } catch (e) {
                        console.log("Message delete error:", e.message); // ignore error
                    }
                }

                delete ctx.session.awaitingButtonsRegulation;
                return;
            }
        } catch (err) {
            console.error("❌ Error in incoming text handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while saving. Please try again.");
            } catch (_) { }
            // clear sessions to avoid stuck states
            if (ctx.session?.awaitingTextRegulation) delete ctx.session.awaitingTextRegulation;
            if (ctx.session?.awaitingButtonsRegulation) delete ctx.session.awaitingButtonsRegulation;
        }

        if (typeof next === "function") {
            await next();
        }
    });

    // ===== HANDLE INCOMING MEDIA SAVE (with validateOwner + chat title in success) =====
    bot.on(["photo", "video", "document"], async (ctx, next) => {
        try {
            if (!ctx.session || !ctx.session.awaitingMediaRegulation) return typeof next === "function" ? await next() : undefined;

            let { chatIdStr, userId } = ctx.session.awaitingMediaRegulation;
            // validate owner (also ensures DB transfer if needed)
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // not owner or validation failed
                delete ctx.session.awaitingMediaRegulation;
                return;
            }

            // extract file id and media type
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

            // save into DB (upsert)
            // NOTE: do NOT set enabled true automatically
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.setregulation_message.media`]: fileId,
                        [`settings.${chatIdStr}.setregulation_message.media_type`]: mediaType
                    }
                },
                { upsert: true }
            );

            // confirmation buttons
            const buttons = [
                [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ];

            const successCaption = `✅ <b>Media regulation saved</b> for <b>${chat.title || chatIdStr}</b>.\n\n<i>Note: This does not enable the regulation. Use the Turn On button to activate it.</i>`;

            await ctx.reply(successCaption,
                { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) }
            );
            if (ctx?.session?.set_regulation_message_id) {
                try {
                    await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                    delete ctx.session.set_regulation_message_id
                } catch (e) {
                    console.log("Message delete error:", e.message); // ignore error
                }
            }
            delete ctx.session.awaitingMediaRegulation;
        } catch (err) {
            console.error("❌ Error in incoming media handler:", err);
            try {
                await ctx.reply("⚠️ Something went wrong while saving the media. Please try again.");
            } catch (_) { }
            if (ctx.session?.awaitingMediaRegulation) delete ctx.session.awaitingMediaRegulation;
        }

        if (typeof next === "function") {
            await next();
        }
    });

    // ===== SEE TEXT =====
    bot.action(/SEE_REG_RULES_TEXT_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const text = userDoc?.settings?.[chatIdStr]?.setregulation_message?.text;

        if (!text) {
            return ctx.answerCbQuery("❌ No text set yet!", { show_alert: true });
        }

        await ctx.reply(text, { parse_mode: "HTML" });
    });

    // ===== SEE MEDIA =====
    bot.action(/SEE_REG_RULES_MEDIA_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message;
        if (!reg?.media) {
            return ctx.answerCbQuery("❌ No media set yet!", { show_alert: true });
        }

        let sentMsg;
        if (reg?.media_type === "photo") {
            sentMsg = await ctx.replyWithPhoto(reg.media);
        } else if (reg?.media_type === "video") {
            sentMsg = await ctx.replyWithVideo(reg.media);
        } else {
            sentMsg = await ctx.replyWithDocument(reg.media);
        }

        ctx.session.set_regulation_message_id = sentMsg.message_id;
    });

    // ===== SEE REGULATION BUTTONS =====
    bot.action(/SEE_REG_RULES_BUTTONS_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const buttonsData = userDoc?.settings?.[chatIdStr]?.setregulation_message?.buttons;

        if (!buttonsData || buttonsData.length === 0) {
            return ctx.answerCbQuery("❌ No buttons set yet!", { show_alert: true });
        }

        const inlineKeyboard = [];

        // Iterate row by row
        buttonsData.forEach((row) => {
            const rowButtons = [];
            row.forEach((btn) => {
                if (!btn?.text || !btn?.content) return;

                const content = btn.content.trim();

                if (/^(https?:\/\/|t\.me\/|@|[a-z0-9\-]+\.[a-z]{2,})/i.test(content)) {
                    let link = content.trim();

                    if (link.startsWith('@')) {
                        // @username ko normalize karke t.me link banado
                        link = `https://t.me/${link.slice(1)}`;
                    } else if (link.startsWith('t.me/')) {
                        // agar "t.me/" se start ho raha hai to https add karo
                        link = `https://${link}`;
                    } else if (!/^https?:\/\//i.test(link)) {
                        // agar sirf domain type (jaise link.com) hai to https:// add karo
                        link = `https://${link}`;
                    }

                    rowButtons.push(Markup.button.url(btn.text, link));
                } else if (content.startsWith("popup:")) {
                    const encodedContent = Buffer.from(btn.content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `POPUP_${encodedContent}`));
                } else if (content.startsWith("alert:")) {
                    const encoded = Buffer.from(content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `ALERT_${encoded}`));
                } else if (content.startsWith("share:")) {
                    const shareText = content.replace(/^share:/, "").trim(); // prefix hata diya
                    rowButtons.push(Markup.button.switchToChat(btn.text, shareText));
                } else if (content.startsWith("copy:")) {
                    const copyText = content.replace("copy:", "").trim();
                    // Telegram doesn't support direct "copy to clipboard" inline action;
                    // we fallback to a callback that will send the text to the user for copying.
                    const encoded = Buffer.from(copyText, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `COPYTXT_${encoded}`));
                } else if (content === "del") {
                    const encoded = Buffer.from(content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `DEL_${encoded}`));
                } else if (content.startsWith("personal:")) {
                    const command = content.replace("personal:", "").trim(); // => command2
                    const encoded = Buffer.from(command, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `PERSONAL_${encoded}`));
                } else {
                    // fallback as callback button
                    const encoded = Buffer.from(content, "utf8").toString("base64");
                    rowButtons.push(Markup.button.callback(btn.text, `GENERIC_${encoded}`));
                }
            });
            if (rowButtons.length) inlineKeyboard.push(rowButtons);
        });

        // back + main menu
        inlineKeyboard.push([
            Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]);

        await safeEditOrSend(ctx, "🔠 <b>Saved Buttons:</b>", {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: inlineKeyboard }
        });
    });

    // COPY text callback handler (sends text to user privately)
    bot.action(/COPYTXT_(.+)/, async (ctx) => {
        try {
            const encoded = ctx.match[1];
            const decoded = Buffer.from(encoded, "base64").toString("utf8");
            await ctx.answerCbQuery("Copied text will be sent to you.", { show_alert: false });
            await ctx.reply(`Here is the text to copy:\n\n${decoded}`);
        } catch (err) {
            console.error("Error in COPYTXT handler:", err);
            await ctx.answerCbQuery("❌ Could not retrieve the text.", { show_alert: true });
        }
    });

    // ===== FULL PREVIEW =====
    bot.action(/PREVIEW_REGULATION_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message;

        if (!reg) {
            return ctx.answerCbQuery("❌ No regulation saved or it's disabled! Turn it ON to preview.", { show_alert: true });
        }

        // Build inline keyboard from saved user buttons
        let inlineKeyboard = [];
        if (reg.buttons && reg.buttons.length) {
            reg.buttons.forEach((row) => {
                const rowButtons = [];
                row.forEach((btn) => {
                    if (!btn?.text || !btn?.content) return;

                    const content = btn.content.trim();

                    if (/^(https?:\/\/|t\.me\/|@|[a-z0-9\-]+\.[a-z]{2,})/i.test(content)) {
                        let link = content.trim();

                        if (link.startsWith('@')) {
                            // @username ko normalize karke t.me link banado
                            link = `https://t.me/${link.slice(1)}`;
                        } else if (link.startsWith('t.me/')) {
                            // agar "t.me/" se start ho raha hai to https add karo
                            link = `https://${link}`;
                        } else if (!/^https?:\/\//i.test(link)) {
                            // agar sirf domain type (jaise link.com) hai to https:// add karo
                            link = `https://${link}`;
                        }

                        rowButtons.push(Markup.button.url(btn.text, link));
                    } else if (content.startsWith("popup:")) {
                        const encodedContent = Buffer.from(btn.content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `POPUP_${encodedContent}`));
                    } else if (content.startsWith("alert:")) {
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `ALERT_${encoded}`));
                    } else if (content.startsWith("share:")) {
                        const shareText = content.replace(/^share:/, "").trim(); // prefix hata diya
                        rowButtons.push(Markup.button.switchToChat(btn.text, shareText));
                    } else if (content.startsWith("copy:")) {
                        const copyText = content.replace("copy:", "").trim();
                        const encoded = Buffer.from(copyText, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `COPYTXT_${encoded}`));
                    } else if (content === "del") {
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `DEL_${encoded}`));
                    } else if (content.startsWith("personal:")) {
                        const command = content.replace("personal:", "").trim(); // => command2
                        const encoded = Buffer.from(command, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `PERSONAL_${encoded}`));
                    } else {
                        // fallback as callback button
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `GENERIC_${encoded}`));
                    }
                });
                if (rowButtons.length) inlineKeyboard.push(rowButtons);
            });
        }

        // ====== 1) Send regulation preview (media or text) ======
        if (reg.media) {
            try {
                if (reg.media_type === "photo") {
                    await ctx.replyWithPhoto(reg.media, {
                        caption: reg.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } else if (reg.media_type === "video") {
                    await ctx.replyWithVideo(reg.media, {
                        caption: reg.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } else if (reg.media_type === "document") {
                    await ctx.replyWithDocument(reg.media, {
                        caption: reg.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                }
            } catch (err) {
                console.error("Preview send failed:", err);
            }
        }

        if (!(reg.buttons && reg.buttons.length) && !reg.media) {
            ctx.reply(reg.text, { parse_mode: "HTML" });
        }
    });

    // ===== REMOVE TEXT =====
    bot.action(/REMOVE_REG_RULES_TEXT_(.+)/, async (ctx) => {
        ctx.session = {};
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        // validate owner (also handles DB transfer if needed)
        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            // unset the saved text
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.setregulation_message.text`]: "" } },
                { new: true }
            );

            // decide whether setregulation_message.enabled should remain true
            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = refreshed?.settings?.[chatIdStr]?.setregulation_message || {};
            const stillHasSomething = !!(reg.text || reg.media || (Array.isArray(reg.buttons) && reg.buttons.length));

            if (!stillHasSomething) {
                // disable if nothing left
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } }
                );
            }

            await safeEditOrSend(
                ctx,
                `✅ <b>Text removed</b> for chat <b>${chat.title || chatIdStr}</b>.`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
                            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                        ]
                    ])
                }
            );
        } catch (err) {
            console.error("Error removing regulation text:", err);
            await ctx.reply("⚠️ Something went wrong while removing the text. Try again.");
        }
    });

    // ===== REMOVE MEDIA =====
    bot.action(/REMOVE_REG_RULES_MEDIA_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            // unset media, media_type and caption if any
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.setregulation_message.media`]: "",
                        [`settings.${chatIdStr}.setregulation_message.media_type`]: "",
                        [`settings.${chatIdStr}.setregulation_message.caption`]: ""
                    }
                },
                { new: true }
            );

            // check if anything remains and disable if none
            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = refreshed?.settings?.[chatIdStr]?.setregulation_message || {};
            const stillHasSomething = !!(reg.text || reg.media || (Array.isArray(reg.buttons) && reg.buttons.length));

            if (!stillHasSomething) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } }
                );
            }

            await safeEditOrSend(
                ctx,
                `✅ <b>Media removed</b> for chat <b>${chat.title || chatIdStr}</b>.`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
                            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                        ]
                    ])
                }
            );
        } catch (err) {
            console.error("Error removing regulation media:", err);
            await ctx.reply("⚠️ Something went wrong while removing the media. Try again.");
        }
    });

    // ===== REMOVE BUTTONS =====
    bot.action(/REMOVE_REG_RULES_BUTTONS_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            // unset buttons array
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.setregulation_message.buttons`]: "" } },
                { new: true }
            );

            // check if anything remains and disable if none
            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const reg = refreshed?.settings?.[chatIdStr]?.setregulation_message || {};
            const stillHasSomething = !!(reg.text || reg.media || (Array.isArray(reg.buttons) && reg.buttons.length));

            if (!stillHasSomething) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.setregulation_message.enabled`]: false } }
                );
            }

            await safeEditOrSend(
                ctx,
                `✅ <b>Url buttons removed</b> for chat <b>${chat.title || chatIdStr}</b>.`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
                            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                        ]
                    ])
                }
            );
        } catch (err) {
            console.error("Error removing regulation buttons:", err);
            await ctx.reply("⚠️ Something went wrong while removing the buttons. Try again.");
        }
    });
};
