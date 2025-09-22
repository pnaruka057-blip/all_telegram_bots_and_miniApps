// regulation.js
const { Markup, session } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");

module.exports = (bot) => {
    // ====== MAIN SET REGULATION MENU ======
    bot.action(/SET_REGULATION_(.+)/, async (ctx) => {
        const userId = ctx.from.id;
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        const textMsg = `📜 <b>Group's regulations</b>\nFrom this menu you can manage the group's regulations, that will be shown with the command /rules.`;

        const buttons = [
            [Markup.button.callback("🖋 Customize message", `CUSTOMIZE_RULES_${chatIdStr}`)],
            [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        });
    });

    // ====== CUSTOMIZE RULES ======
    bot.action(/^CUSTOMIZE_RULES_(.+)$/, async (ctx) => {
        try {
            if (ctx?.session?.set_regulation_message_id) {
                try {
                    await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                    delete ctx.session.set_regulation_message_id
                } catch (e) {
                    console.log("Message delete error:", e.message); // ignore error
                }
            }
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
                `👉 Use the buttons below to edit or preview the regulation for <b>${chat.title || chatIdStr}</b>.`;

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

        const textMsg = `👉🏻 <b>Send now the message you want to set.</b>\n<i>You can send it already formatted or use HTML.</i>`;

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
            "👉🏻 <b>Send now the media</b> (photos, videos, stickers...) you want to set.\n" +
            "<i>You can also enter a caption.</i>";

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

        const textMsg =
            "👉🏻 <b>Now send the list of buttons</b> to insert on the inline keyboard, with texts and links, using this parse:\n\n" +
            "<code>Button text - link.com\nButton text - link.net</code>\n\n" +
            "• If you want to set up 2 buttons in the same row, separate them with <b>&&</b>.\n" +
            "• By setting <b>rules</b> as link, the button will link users to the group rules, if set with the bot.\n\n" +
            "<b>Example:</b>\nGroup - t.me/username && Channel - @username\nGroup regulation - rules";

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
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.setregulation_message.text`]: text,
                            [`settings.${chatIdStr}.setregulation_message.enabled`]: true
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Text regulation saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard(buttons)
                });

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
                    return;
                }

                const parsedButtons = res.buttons;

                // Save to DB exactly in the requested format
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.setregulation_message.buttons`]: parsedButtons,
                            [`settings.${chatIdStr}.setregulation_message.enabled`]: true
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Url Buttons saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard(buttons)
                });

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
            if (!ctx.session || !ctx.session.awaitingMediaRegulation) return;

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
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.setregulation_message.media`]: fileId,
                        [`settings.${chatIdStr}.setregulation_message.media_type`]: mediaType,
                        [`settings.${chatIdStr}.setregulation_message.enabled`]: true
                    }
                },
                { upsert: true }
            );

            // confirmation buttons
            const buttons = [
                [Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ];

            const successCaption = `✅ <b>Media regulation saved</b> for <b>${chat.title || chatIdStr}</b>.`;

            await ctx.reply(successCaption,
                { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) }
            );

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

        await safeEditOrSend(ctx, `📄 <b>Saved Regulation Text:</b>\n\n${text}`, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "⬅️ Back", callback_data: `CUSTOMIZE_RULES_${chatIdStr}` }]
                ]
            }
        });
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

        const buttons = [
            [
                Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]
        ];

        if (ctx?.session?.set_regulation_message_id) {
            try {
                await ctx.deleteMessage(ctx.session.set_regulation_message_id);
                delete ctx.session.set_regulation_message_id
            } catch (e) {
                console.log("Message delete error:", e.message); // ignore error
            }
        }

        let sentMsg;
        if (reg.media_type === "photo") {
            sentMsg = await ctx.replyWithPhoto(reg.media, {
                caption: reg.caption || "",
                reply_markup: { inline_keyboard: buttons }
            });
        } else if (reg.media_type === "video") {
            sentMsg = await ctx.replyWithVideo(reg.media, {
                caption: reg.caption || "",
                reply_markup: { inline_keyboard: buttons }
            });
        } else if (reg.media_type === "document") {
            sentMsg = await ctx.replyWithDocument(reg.media, {
                caption: reg.caption || "",
                reply_markup: { inline_keyboard: buttons }
            });
        } else {
            sentMsg = await ctx.reply("⚠️ Media exists but type is unknown.", {
                reply_markup: { inline_keyboard: buttons }
            });
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
                    rowButtons.push({ text: btn.text, copy_text: { text: copyText } });
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

    // ===== FULL PREVIEW =====
    bot.action(/PREVIEW_REGULATION_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const reg = userDoc?.settings?.[chatIdStr]?.setregulation_message;

        if (!reg || !reg.enabled) {
            return ctx.answerCbQuery("❌ No regulation saved yet!", { show_alert: true });
        }

        // Build inline keyboard from saved user buttons
        let inlineKeyboard = [];
        if (reg.buttons && reg.buttons.length) {
            let row = [];
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
                        rowButtons.push({ text: btn.text, copy_text: { text: copyText } });
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
            if (row.length) inlineKeyboard.push(row);
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

        // ====== 2) Send separate navigation message ======
        await safeEditOrSend(ctx, "⚙️ Choose an option below:", {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        Markup.button.callback("⬅️ Back", `CUSTOMIZE_RULES_${chatIdStr}`),
                        Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                    ]
                ]
            }
        });
    });

    // ===== REMOVE TEXT =====
    bot.action(/REMOVE_REG_RULES_TEXT_(.+)/, async (ctx) => {
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
