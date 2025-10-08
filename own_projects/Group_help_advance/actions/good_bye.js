const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");

// helper to check if any goodbye content exists
function computeGoodbyeState(goodbye) {
    const msg = goodbye || {};
    const hasText = !!(msg.text && msg.text.trim());
    const hasMedia = !!(msg.media && msg.media_type);
    const hasButtons = Array.isArray(msg.buttons) && msg.buttons.length > 0;
    return { hasText, hasMedia, hasButtons };
}

async function renderGoodbyeMenu(ctx, chatIdStr, userId) {
    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;

    const userSettings = await user_setting_module.findOne({ user_id: userId }).lean();
    const goodbye = userSettings?.settings?.[chatIdStr]?.goodbye || {};

    const enabled = !!goodbye.enabled;
    const mode = goodbye.mode === "first_leave" ? "1️⃣ Send 1st leave" : "🔔 Send at every leave";
    const deleteLast = !!goodbye.delete_last;
    const ok = "✅";
    const no = "❌";

    const text =
        `👋 <b>Goodbye Message</b>\n\n` +
        `From this menu you can set a goodbye message that will be sent when someone leaves the group.\n\n` +
        `<b>Status</b>: ${enabled ? "On " + ok : "Off " + no}\n` +
        `<b>Mode</b>: ${mode}\n` +
        `<b>Delete previous goodbye message</b>: ${deleteLast ? 'On ' + ok : 'Off ' + no}\n\n` +
        `<i>👉 Use the buttons below to control this setting for <b>${(isOwner) ? isOwner?.title : chatIdStr}</b>.</i>`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback("❌ Turn off", `GOODBYE_TURN_OFF_${chatIdStr}`),
            Markup.button.callback("✅ Turn on", `GOODBYE_TURN_ON_${chatIdStr}`)
        ],
        [Markup.button.callback("✍️ Customize message", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
        [
            Markup.button.callback("🔔 Always send", `GOODBYE_MODE_ALWAYS_${chatIdStr}`),
            Markup.button.callback("1️⃣ Send 1st leave", `GOODBYE_MODE_FIRST_${chatIdStr}`)
        ],
        [
            Markup.button.callback(deleteLast ? "Delete previous message ✅" : "Delete previous message ❌", `GOODBYE_DELETE_LAST_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
}

// reusable customize renderer
async function renderCustomizeGoodbyeMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const chatSettings = (userDoc && userDoc.settings && userDoc.settings[chatIdStr]) || {};
    const goodbye = chatSettings.goodbye || {};
    const msg = goodbye || {};

    const hasText = !!(msg.text && msg.text.trim());
    const hasMedia = !!(msg.media && msg.media_type);
    const hasButtons = Array.isArray(msg.buttons) && msg.buttons.length > 0;

    const ok = "✅";
    const no = "❌";

    const textMsg =
        `👋 <b>Goodbye message</b>\n\n` +
        `Use the buttons below to choose what you want to set\n\n` +
        `<b>Current status:</b>\n` +
        ` ${hasText ? ok : no} 📄 Text\n` +
        ` ${hasMedia ? ok : no} 📸 Media\n` +
        ` ${hasButtons ? ok : no} 🔠 Url Buttons\n\n` +
        `<i>👉 Use the buttons below to edit or preview the goodbye message.</i>`;

    const buttons = [
        [
            Markup.button.callback("📄 Text", `SET_GOODBYE_TEXT_${chatIdStr}`),
            Markup.button.callback(hasText ? "👀 See" : "➕ Add", hasText ? `SEE_GOODBYE_TEXT_${chatIdStr}` : `SET_GOODBYE_TEXT_${chatIdStr}`)
        ],
        [
            Markup.button.callback("📸 Media", `SET_GOODBYE_MEDIA_${chatIdStr}`),
            Markup.button.callback(hasMedia ? "👀 See" : "➕ Add", hasMedia ? `SEE_GOODBYE_MEDIA_${chatIdStr}` : `SET_GOODBYE_MEDIA_${chatIdStr}`)
        ],
        [
            Markup.button.callback("🔠 Url Buttons", `SET_GOODBYE_BUTTONS_${chatIdStr}`),
            Markup.button.callback(hasButtons ? "👀 See" : "➕ Add", hasButtons ? `SEE_GOODBYE_BUTTONS_${chatIdStr}` : `SET_GOODBYE_BUTTONS_${chatIdStr}`)
        ],
        [Markup.button.callback("👀 Full preview", `PREVIEW_GOODBYE_${chatIdStr}`)],
        [
            Markup.button.callback("⬅️ Back", `SET_GOODBYE_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]
    ];

    const message_id = await safeEditOrSend(ctx, textMsg, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
    }, true);

    ctx.session = ctx.session || {};
    ctx.session.set_goodbye_message_id = message_id;
}

module.exports = (bot) => {
    // OPEN main goodbye menu
    bot.action(/^SET_GOODBYE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("Error in SET_GOODBYE action:", err);
            try { await ctx.answerCbQuery("⚠️ Error while loading menu."); } catch (e) { /* ignore */ }
        }
    });

    // TURN ON with auto-redirect if no content set
    bot.action(/^GOODBYE_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // Check if text or media or buttons exist
            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const goodbye = refreshed?.settings?.[chatIdStr]?.goodbye || {};
            const { hasText, hasMedia, hasButtons } = computeGoodbyeState(goodbye);

            if (!hasText && !hasMedia && !hasButtons) {
                await renderCustomizeGoodbyeMenu(ctx, chatIdStr, userId);
                return;
            }

            const update = {
                $setOnInsert: { user_id: userId },
                $set: { [`settings.${chatIdStr}.goodbye.enabled`]: true }
            };

            const res = await user_setting_module.updateOne({ user_id: userId }, update, { upsert: true });

            if (res.acknowledged) {
                await ctx.answerCbQuery("Goodbye turned on.");
            } else {
                await ctx.answerCbQuery("⚠️ Could not update settings (not acknowledged).");
            }

            await renderGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("GOODBYE_TURN_ON error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (e) { /* ignore */ }
        }
    });

    // TURN OFF
    bot.action(/^GOODBYE_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const update = {
                $setOnInsert: { user_id: userId },
                $set: { [`settings.${chatIdStr}.goodbye.enabled`]: false }
            };

            const res = await user_setting_module.updateOne({ user_id: userId }, update, { upsert: true });

            if (res.acknowledged) {
                await ctx.answerCbQuery("Goodbye turned off.");
            } else {
                await ctx.answerCbQuery("⚠️ Could not update settings (not acknowledged).");
            }

            await renderGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("GOODBYE_TURN_OFF error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (e) { /* ignore */ }
        }
    });

    // MODE: ALWAYS
    bot.action(/^GOODBYE_MODE_ALWAYS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.goodbye.mode`]: "always" } },
                { upsert: true }
            );

            await ctx.answerCbQuery("Mode set to: send on every leave");
            await renderGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("GOODBYE_MODE_ALWAYS error:", err);
        }
    });

    // MODE: FIRST LEAVE
    bot.action(/^GOODBYE_MODE_FIRST_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.goodbye.mode`]: "first_leave" } },
                { upsert: true }
            );

            await ctx.answerCbQuery("Mode set to: send on first leave");
            await renderGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("GOODBYE_MODE_FIRST error:", err);
        }
    });

    // TOGGLE delete_last
    bot.action(/^GOODBYE_DELETE_LAST_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userSettings = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = !!userSettings?.settings?.[chatIdStr]?.goodbye?.delete_last;

            const newVal = !current;

            const res = await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.goodbye.delete_last`]: newVal }
                },
                { upsert: true }
            );

            if (res.acknowledged) {
                await ctx.answerCbQuery(`Delete previous goodbye message: ${newVal ? "On ✅" : "Off ❌"}`);
            } else {
                await ctx.answerCbQuery("⚠️ Could not save setting.");
            }

            await renderGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("GOODBYE_DELETE_LAST toggle error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while toggling setting."); } catch (e) { /* ignore */ }
        }
    });

    // ====== CUSTOMIZE GOODBYE (call renderer) ======
    bot.action(/^CUSTOMIZE_GOODBYE_(-?\d+)$/, async (ctx) => {
        try {
            const userId = ctx.from.id;
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            await renderCustomizeGoodbyeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("❌ Error in CUSTOMIZE_GOODBYE handler:", err);
            try { await ctx.reply("⚠️ Something went wrong while opening goodbye editor. Please try again."); } catch { }
        }
    });

    // ===== TEXT SETTING =====
    bot.action(/^SET_GOODBYE_TEXT_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const textMsg =
            "✍️ <b>Send the goodbye text you want to set.</b>\n\n" +
            `For message design options (placeholders and HTML), <a href="${process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE}/text-message-design">click here</a>.`;

        const buttons = [
            [Markup.button.callback("🚫 Remove message", `REMOVE_GOODBYE_TEXT_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_GOODBYE_${chatIdStr}`)]
        ];

        let message_id = await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        }, true);

        ctx.session = ctx.session || {};
        ctx.session.awaitingGoodbyeText = { chatIdStr, userId, message_id };
        await ctx.answerCbQuery();
    });

    bot.action(/^SEE_GOODBYE_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const txt = userDoc?.settings?.[chatIdStr]?.goodbye?.text;

            if (!txt) {
                return ctx.answerCbQuery("❌ No goodbye text set yet!", { show_alert: true });
            }

            await ctx.answerCbQuery();

            await ctx.reply(txt, { parse_mode: "HTML" });
        } catch (err) {
            console.error("SEE_GOODBYE_TEXT error:", err);
        }
    });

    // ===== MEDIA SETTING =====
    bot.action(/^SET_GOODBYE_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const textMsg =
                "📸 <b>Send now the media</b> (photo/video/document) you want to use as goodbye media.\n" +
                "<i>You can also forward a message from the source.</i>";

            const buttons = [
                [Markup.button.callback("🚫 Remove media", `REMOVE_GOODBYE_MEDIA_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `CUSTOMIZE_GOODBYE_${chatIdStr}`)]
            ];

            let message_id = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            }, true);

            ctx.session = ctx.session || {};
            ctx.session.awaitingGoodbyeMedia = { chatIdStr, userId, message_id };
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SET_GOODBYE_MEDIA error:", err);
        }
    });

    bot.action(/^SEE_GOODBYE_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const msg = userDoc?.settings?.[chatIdStr]?.goodbye;
            if (!msg?.media || !msg?.media_type) {
                return ctx.answerCbQuery("❌ No media set yet!", { show_alert: true });
            }

            let sentMsg;
            if (msg?.media_type === "photo") {
                sentMsg = await ctx.replyWithPhoto(msg.media);
            } else if (msg?.media_type === "video") {
                sentMsg = await ctx.replyWithVideo(msg.media);
            } else {
                sentMsg = await ctx.replyWithDocument(msg.media);
            }

            ctx.session = ctx.session || {};
            ctx.session.set_goodbye_message_id = sentMsg.message_id;
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SEE_GOODBYE_MEDIA error:", err);
        }
    });

    // ===== URL BUTTONS SETTING =====
    bot.action(/^SET_GOODBYE_BUTTONS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const builderUrl = process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE; // replace with your real tool if available
        const textMsg =
            `👉🏻 <b>Send now the Buttons</b> you want to set.\n\n` +
            `If you need a visual tool to build the buttons and get the exact code - \n<a href="${builderUrl}/buttons-design">Click Here</a>.\n\n`

        const buttons = [
            [Markup.button.callback("🚫 Remove Keyboard", `REMOVE_GOODBYE_BUTTONS_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_GOODBYE_${chatIdStr}`)]
        ];

        let message_id = await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons)
        }, true);

        ctx.session = ctx.session || {};
        ctx.session.awaitingGoodbyeButtons = { chatIdStr, userId, message_id };
        await ctx.answerCbQuery();
    });

    bot.action(/^SEE_GOODBYE_BUTTONS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const buttonsData = userDoc?.settings?.[chatIdStr]?.goodbye?.buttons;

            if (!buttonsData || buttonsData.length === 0) {
                return ctx.answerCbQuery("❌ No buttons set yet!", { show_alert: true });
            }

            const inlineKeyboard = [];
            buttonsData.forEach((row) => {
                const rowButtons = [];
                row.forEach((btn) => {
                    if (!btn?.text || !btn?.content) return;

                    const content = btn.content.trim();

                    if (/^(https?:\/\/|t\.me\/|@|[a-z0-9\-]+\.[a-z]{2,})/i.test(content)) {
                        let link = content.trim();

                        if (link.startsWith('@')) {
                            link = `https://t.me/${link.slice(1)}`;
                        } else if (link.startsWith('t.me/')) {
                            link = `https://${link}`;
                        } else if (!/^https?:\/\//i.test(link)) {
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
                        const shareText = content.replace(/^share:/, "").trim();
                        rowButtons.push(Markup.button.switchToChat(btn.text, shareText));
                    } else if (content.startsWith("copy:")) {
                        const copyText = content.replace("copy:", "").trim();
                        rowButtons.push({ text: btn.text, copy_text: { text: copyText } });
                    } else if (content === "del") {
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `DEL_${encoded}`));
                    } else if (content.startsWith("personal:")) {
                        const command = content.replace("personal:", "").trim();
                        const encoded = Buffer.from(command, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `PERSONAL_${encoded}`));
                    } else {
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `GENERIC_${encoded}`));
                    }
                });
                if (rowButtons.length) inlineKeyboard.push(rowButtons);
            });

            inlineKeyboard.push([
                Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, "🔠 <b>Saved Buttons:</b>", {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SEE_GOODBYE_BUTTONS error:", err);
        }
    });

    // ===== HANDLE INCOMING TEXT SAVE =====
    bot.on("text", async (ctx, next) => {
        try {
            if (ctx.session?.awaitingGoodbyeText) {
                let { chatIdStr, userId, message_id } = ctx.session.awaitingGoodbyeText;
                const text = ctx.message.text;

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) { delete ctx.session.awaitingGoodbyeText; return; }

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.goodbye.text`]: text,
                            [`settings.${chatIdStr}.goodbye.enabled`]: true
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Goodbye text saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                if (message_id) {
                    try {
                        await ctx.deleteMessage(message_id);
                    } catch (e) {
                        console.log("Message delete error:", e.message);
                    }
                }

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
                delete ctx.session.awaitingGoodbyeText;
                return;
            }

            if (ctx.session?.awaitingGoodbyeButtons) {
                let { chatIdStr, userId, message_id } = ctx.session.awaitingGoodbyeButtons;
                const raw = (ctx.message.text || "").trim();

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) { delete ctx.session.awaitingGoodbyeButtons; return; }

                const res = await parseButtonsSyntax(ctx, raw);
                if (!res.match) return;

                const parsedButtons = res.buttons;

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.goodbye.buttons`]: parsedButtons,
                            [`settings.${chatIdStr}.goodbye.enabled`]: true
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Buttons saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                if (message_id) {
                    try {
                        await ctx.deleteMessage(message_id);
                    } catch (e) {
                        console.log("Message delete error:", e.message);
                    }
                }

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
                delete ctx.session.awaitingGoodbyeButtons;
                return;
            }
        } catch (err) {
            console.error("❌ Error in incoming text handler (goodbye):", err);
            try { await ctx.reply("⚠️ Something went wrong while saving. Please try again."); } catch { }
            if (ctx.session?.awaitingGoodbyeText) delete ctx.session.awaitingGoodbyeText;
            if (ctx.session?.awaitingGoodbyeButtons) delete ctx.session.awaitingGoodbyeButtons;
        }

        if (typeof next === "function") await next();
    });

    // ===== HANDLE INCOMING MEDIA SAVE =====
    bot.on(["photo", "video", "document"], async (ctx, next) => {
        try {
            if (!ctx.session || !ctx.session.awaitingGoodbyeMedia) return;

            let { chatIdStr, userId, message_id } = ctx.session.awaitingGoodbyeMedia;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) { delete ctx.session.awaitingGoodbyeMedia; return; }

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

            if (!fileId) {
                await ctx.reply("⚠️ Could not extract file. Try sending again.");
                delete ctx.session.awaitingGoodbyeMedia;
                return;
            }

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.goodbye.media`]: fileId,
                        [`settings.${chatIdStr}.goodbye.media_type`]: mediaType,
                        [`settings.${chatIdStr}.goodbye.enabled`]: true
                    }
                },
                { upsert: true, new: true }
            );

            const buttons = [
                [Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ];

            const successCaption = `✅ <b>Goodbye media saved</b> for <b>${chat.title || chatIdStr}</b>.`;
            if (message_id) {
                try {
                    await ctx.deleteMessage(message_id);
                } catch (e) {
                    console.log("Message delete error:", e.message);
                }
            }
            await ctx.reply(successCaption, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
            delete ctx.session.awaitingGoodbyeMedia;
        } catch (err) {
            console.error("❌ Error in incoming media handler (goodbye):", err);
            try { await ctx.reply("⚠️ Something went wrong while saving the media. Please try again."); } catch { }
            if (ctx.session?.awaitingGoodbyeMedia) delete ctx.session.awaitingGoodbyeMedia;
        } finally {
            next();
        }
    });

    // ===== FULL PREVIEW GOODBYE =====
    bot.action(/^PREVIEW_GOODBYE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const goodbye = userDoc?.settings?.[chatIdStr]?.goodbye || {};
        if (!goodbye) {
            return ctx.answerCbQuery("❌ No goodbye saved yet!", { show_alert: true });
        }

        let inlineKeyboard = [];
        if (goodbye.buttons && goodbye.buttons.length) {
            goodbye.buttons.forEach((row) => {
                const rowButtons = [];
                row.forEach((btn) => {
                    if (!btn?.text || !btn?.content) return;

                    const content = btn.content.trim();

                    if (/^(https?:\/\/|t\.me\/|@|[a-z0-9\-]+\.[a-z]{2,})/i.test(content)) {
                        let link = content.trim();

                        if (link.startsWith('@')) {
                            link = `https://t.me/${link.slice(1)}`;
                        } else if (link.startsWith('t.me/')) {
                            link = `https://${link}`;
                        } else if (!/^https?:\/\//i.test(link)) {
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
                        const shareText = content.replace(/^share:/, "").trim();
                        rowButtons.push(Markup.button.switchToChat(btn.text, shareText));
                    } else if (content.startsWith("copy:")) {
                        const copyText = content.replace("copy:", "").trim();
                        rowButtons.push({ text: btn.text, copy_text: { text: copyText } });
                    } else if (content === "del") {
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `DEL_${encoded}`));
                    } else if (content.startsWith("personal:")) {
                        const command = content.replace("personal:", "").trim();
                        const encoded = Buffer.from(command, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `PERSONAL_${encoded}`));
                    } else {
                        const encoded = Buffer.from(content, "utf8").toString("base64");
                        rowButtons.push(Markup.button.callback(btn.text, `GENERIC_${encoded}`));
                    }
                });
                if (rowButtons.length) inlineKeyboard.push(rowButtons);
            });
        }

        if (goodbye.media) {
            try {
                if (goodbye.media_type === "photo") {
                    await ctx.replyWithPhoto(goodbye.media, {
                        caption: goodbye.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } else if (goodbye.media_type === "video") {
                    await ctx.replyWithVideo(goodbye.media, {
                        caption: goodbye.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } else if (goodbye.media_type === "document") {
                    await ctx.replyWithDocument(goodbye.media, {
                        caption: goodbye.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                }
            } catch (err) {
                console.error("Preview send failed:", err);
            }
        }

        if (!(goodbye.buttons && goodbye.buttons.length) && !goodbye.media) {
            await ctx.reply(goodbye.text || "", { parse_mode: "HTML" });
        }

        await ctx.answerCbQuery();
    });

    // ===== REMOVE TEXT =====
    bot.action(/^REMOVE_GOODBYE_TEXT_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.goodbye.text`]: "" } },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const goodbye = refreshed?.settings?.[chatIdStr]?.goodbye || {};
            const stillHas = !!(goodbye.text || (goodbye.media && goodbye.media) || (Array.isArray(goodbye.buttons) && goodbye.buttons.length));

            if (!stillHas) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.goodbye.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ <b>Goodbye text removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("Error removing goodbye text:", err);
            await ctx.reply("⚠️ Something went wrong while removing the text. Try again.");
        }
    });

    // ===== REMOVE MEDIA =====
    bot.action(/^REMOVE_GOODBYE_MEDIA_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.goodbye.media`]: "",
                        [`settings.${chatIdStr}.goodbye.media_type`]: ""
                    }
                },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const goodbye = refreshed?.settings?.[chatIdStr]?.goodbye || {};
            const stillHas = !!(goodbye.text || (goodbye.media && goodbye.media) || (Array.isArray(goodbye.buttons) && goodbye.buttons.length));

            if (!stillHas) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.goodbye.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ <b>Goodbye media removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("Error removing goodbye media:", err);
            await ctx.reply("⚠️ Something went wrong while removing the media. Try again.");
        }
    });

    // ===== REMOVE BUTTONS =====
    bot.action(/^REMOVE_GOODBYE_BUTTONS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.goodbye.buttons`]: "" } },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const goodbye = refreshed?.settings?.[chatIdStr]?.goodbye || {};

            await safeEditOrSend(ctx, `✅ <b>Goodbye buttons removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_GOODBYE_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("Error removing goodbye buttons:", err);
            await ctx.reply("⚠️ Something went wrong while removing the buttons. Try again.");
        }
    });
};