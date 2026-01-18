const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");
const encode_payload = require("../helpers/encode_payload");
const { ALLOWED_PLACEHOLDERS } = require("../helpers/const")

// ------------------------- Strict HTML guard (Telegram) -------------------------
// Telegram HTML allows only a limited set of tags.
// This validator blocks unsupported tags and common syntax issues BEFORE saving.

function findInvalidPlaceholders(input) {
    const text = String(input || "");
    const matches = text.match(/\{[A-Za-z0-9_]+\}/g) || [];
    const invalid = [];
    for (const m of matches) {
        if (!ALLOWED_PLACEHOLDERS.has(m.toUpperCase())) invalid.push(m);
    }
    return [...new Set(invalid)];
}

const _WELCOME_ALLOWED_TAGS = new Set([
    'b', 'strong',
    'i', 'em',
    'u', 'ins',
    's', 'strike', 'del',
    'code', 'pre',
    'a',
    'tg-spoiler',
]);

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}


function _extractAttr(attrs, name) {
    const re = new RegExp(`\\b${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
    const m = String(attrs || '').match(re);
    if (!m) return null;
    let v = m[1];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
}

function validateTelegramHtmlStrict(html) {
    const text = String(html ?? '');

    // Quick: if no tags, ok
    if (!/[<>]/.test(text)) return { ok: true, errors: [] };

    const errors = [];
    const stack = [];

    // Match tags like <b>, </b>, <a href="...">, <em/>
    const tagRe = /<\s*(\/)?\s*([a-z0-9-]+)([^>]*)>/gi;
    let m;

    while ((m = tagRe.exec(text))) {
        const isClose = !!m[1];
        const rawName = String(m[2] || '');
        const name = rawName.toLowerCase();
        const attrs = String(m[3] || '');

        // Detect self-closing like <em/> or <em />
        const isSelfClosing = /\/\s*>\s*$/.test(m[0]);

        if (!_WELCOME_ALLOWED_TAGS.has(name)) {
            errors.push(`Unsupported tag <${rawName}>`);
            continue;
        }

        if (!isClose && isSelfClosing) {
            errors.push(`Invalid self-closing tag: <${rawName}/> . Use </${rawName}> to close.`);
            continue;
        }

        // Attributes rules
        const hasAttrs = /\S/.test(attrs.replace(/\/\s*$/, ''));
        if (!isClose && hasAttrs) {
            if (name === 'a') {
                // Allow ONLY href on <a>
                const href = _extractAttr(attrs, 'href');
                if (!href) {
                    errors.push('Tag <a> must include href. Example: <a href="https://example.com">link</a>');
                }

                // Collect attribute names like href, target, rel...
                const attrNameRe = /([a-zA-Z_:][\w:.-]*)\s*=/g;
                const names = [];
                let am;
                while ((am = attrNameRe.exec(attrs))) {
                    names.push(am[1].toLowerCase());
                }

                const extra = names.filter(n => n && n !== 'href');
                if (extra.length) {
                    errors.push('Only href attribute is allowed in <a> tag.');
                }
            } else if (name === 'code') {
                const cleaned = attrs.replace(/\\bclass\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/i, '').trim();
                if (cleaned) errors.push('Only class attribute is allowed in <code> tag.');
            } else {
                errors.push(`Attributes are not allowed in <${rawName}> tag.`);
            }
        }

        // Stack validation
        if (!isClose) {
            stack.push(name);
        } else {
            const last = stack.pop();
            if (last !== name) {
                errors.push(`Tag mismatch: expected </${last || name}> but found </${rawName}>`);
            }
        }
    }

    if (stack.length) {
        errors.push(`Unclosed tag(s): ${stack.map(t => `<${t}>`).join(', ')}`);
    }

    return { ok: errors.length === 0, errors };
}

function _isTelegramHtmlParseError(err) {
    const desc = err?.response?.description || err?.description || '';
    const code = err?.response?.error_code || err?.code;
    return code === 400 && /can't parse entities/i.test(String(desc));
}

async function _validateWithTelegramOrThrow(ctx, htmlText) {
    const sent = await ctx.telegram.sendMessage(ctx.chat.id, htmlText || '', {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: true,
    });
    if (sent?.message_id) {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id); } catch (_) { }
    }
}


async function renderWelcomeMenu(ctx, chatIdStr, userId) {
    const userSettings = await user_setting_module.findOne({ user_id: userId });
    const welcome = userSettings?.settings?.get(chatIdStr)?.welcome || {};

    const enabled = !!welcome.enabled;
    const mode = welcome.mode === "first" ? "1️⃣ Send 1st join" : "🔔 Send at every join";

    // new: delete previous welcome message flag
    const deleteLast = !!welcome.delete_last;

    const ok = "✅";
    const no = "❌";

    const text =
        `💬 <b>Welcome Message</b>\n\n` +
        `From this menu you can set a welcome message that will be sent when someone joins the group.\n\n` +
        `<b>Status</b>: ${enabled ? "On " + ok : "Off " + no}\n` +
        `<b>Mode</b>: ${mode}\n` +
        `<b>Delete previous welcome message</b>: ${deleteLast ? 'On ' + ok : 'Off ' + no}\n\n` +
        `<i>👉 Use the buttons below to edit/preview the welcome message for this chat.</i>`;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback("✅ Turn on", `WELCOME_TURN_ON_${chatIdStr}`),
            Markup.button.callback("❌ Turn off", `WELCOME_TURN_OFF_${chatIdStr}`)
        ],
        [Markup.button.callback("✍️ Customize message", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
        [
            Markup.button.callback("🔔 Always send", `WELCOME_MODE_ALWAYS_${chatIdStr}`),
            Markup.button.callback("1️⃣ Send 1st join", `WELCOME_MODE_FIRST_${chatIdStr}`)
        ],
        [
            Markup.button.callback(deleteLast ? "Delete previous message ✓" : "Delete previous message ✗", `WELCOME_DELETE_LAST_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
}

module.exports = (bot) => {
    bot.action(/^SET_WELCOME_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            // validate owner
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // बस helper call कर दो
            await renderWelcomeMenu(ctx, chatIdStr, userId);

        } catch (err) {
            console.error("Error in SET_WELCOME action:", err);
            try { await ctx.answerCbQuery("⚠️ Error while loading menu."); } catch (e) { /* ignore */ }
        }
    });

    // TURN ON
    bot.action(/^WELCOME_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // अगर आपके schema में user_id stored as string, तो cast कर लें:
            // const userIdKey = String(userId);
            const userIdKey = userId; // change to String(userId) if needed

            const update = {
                $setOnInsert: { user_id: userIdKey },
                $set: { [`settings.${chatIdStr}.welcome.enabled`]: true }
            };

            const res = await user_setting_module.updateOne(
                { user_id: userIdKey },
                update,
                { upsert: true }
            );

            // res can be like: { acknowledged: true, modifiedCount: 1, upsertedId: null, upsertedCount: 0, matchedCount: 1 }
            if (res.acknowledged) {
                await ctx.answerCbQuery("Welcome turned on.");
            } else {
                await ctx.answerCbQuery("⚠️ Could not update settings (not acknowledged).");
            }

            await renderWelcomeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("WELCOME_TURN_ON error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (e) {/* ignore */ }
        }
    });

    // TURN OFF
    bot.action(/^WELCOME_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // अगर schema में user_id string में है तो cast करना मत भूलना
            const userIdKey = userId; // या String(userId)

            const update = {
                $setOnInsert: { user_id: userIdKey },
                $set: { [`settings.${chatIdStr}.welcome.enabled`]: false }
            };

            const res = await user_setting_module.updateOne(
                { user_id: userIdKey },
                update,
                { upsert: true }
            );

            if (res.acknowledged) {
                await ctx.answerCbQuery("Welcome turned off.");
            } else {
                await ctx.answerCbQuery("⚠️ Could not update settings (not acknowledged).");
            }

            await renderWelcomeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("WELCOME_TURN_OFF error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (e) {/* ignore */ }
        }
    });

    // MODE: ALWAYS
    bot.action(/^WELCOME_MODE_ALWAYS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.welcome.mode`]: "always" } },
                { upsert: true }
            );

            await ctx.answerCbQuery("Mode set to: send on every join");
            await renderWelcomeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("WELCOME_MODE_ALWAYS error:", err);
        }
    });

    // MODE: FIRST JOIN
    bot.action(/^WELCOME_MODE_FIRST_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.welcome.mode`]: "first" } },
                { upsert: true }
            );

            await ctx.answerCbQuery("Mode set to: send on first join");
            await renderWelcomeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("WELCOME_MODE_FIRST error:", err);
        }
    });

    // TOGGLE: whether to delete the previous welcome message when sending a new one
    bot.action(/^WELCOME_DELETE_LAST_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            // ensure owner
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // fetch current setting
            const userSettings = await user_setting_module.findOne({ user_id: userId });
            const current = !!userSettings?.settings?.get(chatIdStr)?.welcome?.delete_last;

            const newVal = !current; // flip

            // persist new value
            const userIdKey = userId; // use String(userId) if your schema stores user_id as string
            const res = await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.welcome.delete_last`]: newVal }
                },
                { upsert: true }
            );

            if (res.acknowledged) {
                await ctx.answerCbQuery(`Delete previous welcome message: ${newVal ? "On ✅" : "Off ❌"}`);
            } else {
                await ctx.answerCbQuery("⚠️ Could not save setting.");
            }

            // re-render the welcome menu so the user sees updated status
            await renderWelcomeMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("WELCOME_DELETE_LAST toggle error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while toggling setting."); } catch (e) { /* ignore */ }
        }
    });

    // ====== CUSTOMIZE WELCOME ======
    bot.action(/^CUSTOMIZE_WELCOME_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = {};
            const userId = ctx.from.id;
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const chatSettings = (userDoc && userDoc.settings && userDoc.settings[chatIdStr]) || {};
            const welcome = chatSettings.welcome || {};
            const msg = welcome || {};

            const hasText = !!(msg.text && msg.text.trim());
            const hasMedia = !!(msg.media && msg.media_type);
            const hasButtons = Array.isArray(msg.buttons) && msg.buttons.length > 0;

            const ok = "✅";
            const no = "❌";

            const textMsg =
                `💬 <b>Welcome message</b>\n\n` +
                `Use the buttons below to choose what you want to set\n\n` +
                `<b>Current status:</b>\n` +
                ` ${hasText ? ok : no} 📄 Text\n` +
                ` ${hasMedia ? ok : no} 📸 Media\n` +
                ` ${hasButtons ? ok : no} 🔠 Url Buttons\n\n` +
                `<i>👉 Use the buttons below to edit or preview the welcome message for <b>${chat.title || chatIdStr}</b>.</i>`;

            const buttons = [
                [
                    Markup.button.callback("📄 Text", `SET_WELCOME_TEXT_${chatIdStr}`),
                    Markup.button.callback(hasText ? "👀 See" : "➕ Add", hasText ? `SEE_WELCOME_TEXT_${chatIdStr}` : `SET_WELCOME_TEXT_${chatIdStr}`)
                ],
                [
                    Markup.button.callback("📸 Media", `SET_WELCOME_MEDIA_${chatIdStr}`),
                    Markup.button.callback(hasMedia ? "👀 See" : "➕ Add", hasMedia ? `SEE_WELCOME_MEDIA_${chatIdStr}` : `SET_WELCOME_MEDIA_${chatIdStr}`)
                ],
                [
                    Markup.button.callback("🔠 Url Buttons", `SET_WELCOME_BUTTONS_${chatIdStr}`),
                    Markup.button.callback(hasButtons ? "👀 See" : "➕ Add", hasButtons ? `SEE_WELCOME_BUTTONS_${chatIdStr}` : `SET_WELCOME_BUTTONS_${chatIdStr}`)
                ],
                [Markup.button.callback("👀 Full preview", `PREVIEW_WELCOME_${chatIdStr}`)],
                [
                    Markup.button.callback("⬅️ Back", `SET_WELCOME_${chatIdStr}`),
                    Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                ]
            ];

            const message_id = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            }, true);

            // ensure session exists and store preview msg id for cleanup
            ctx.session = ctx.session || {};
            ctx.session.set_welcome_message_id = message_id;
        } catch (err) {
            console.error("❌ Error in CUSTOMIZE_WELCOME handler:", err);
            try { await ctx.reply("⚠️ Something went wrong while opening welcome editor. Please try again."); } catch { }
        }
    });

    // ===== TEXT SETTING =====
    bot.action(/^SET_WELCOME_TEXT_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const payload = `group-help-advance:text-message-design-with-placeholders`;
        const miniAppLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encode_payload(payload)}`;

        const textMsg =
            "✍️ <b>Send the welcome text you want to set.</b>\n\n" +
            `For message design options (placeholders and HTML), ` +
            `<a href="${miniAppLink}">Click Here</a>.`;

        const buttons = [
            [Markup.button.callback("🚫 Remove message", `REMOVE_WELCOME_TEXT_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_WELCOME_${chatIdStr}`)]
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons),
            disable_web_page_preview: true
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingWelcomeText = { chatIdStr, userId };
        await ctx.answerCbQuery();
    });

    bot.action(/^SEE_WELCOME_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const txt = userDoc?.settings?.[chatIdStr]?.welcome?.text;

            if (!txt) {
                return ctx.answerCbQuery("❌ No welcome text set yet!", { show_alert: true });
            }

            await ctx.answerCbQuery();

            await ctx.reply(txt, { parse_mode: "HTML" });
        } catch (err) {
            console.error("SEE_WELCOME_TEXT error:", err);
        }
    });

    // ===== MEDIA SETTING =====
    bot.action(/^SET_WELCOME_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const textMsg =
                "👉🏻 <b>Send now the media</b> (photos, videos, audio, stickers...) you want to set."

            const buttons = [
                [Markup.button.callback("🚫 Remove media", `REMOVE_WELCOME_MEDIA_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `CUSTOMIZE_WELCOME_${chatIdStr}`)]
            ];

            await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard(buttons)
            });

            ctx.session = ctx.session || {};
            ctx.session.awaitingWelcomeMedia = { chatIdStr, userId };
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SET_WELCOME_MEDIA error:", err);
        }
    });

    bot.action(/^SEE_WELCOME_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const msg = userDoc?.settings?.[chatIdStr]?.welcome;
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

            ctx.session.set_welcome_message_id = sentMsg.message_id;
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SEE_WELCOME_MEDIA error:", err);
        }
    });

    // ===== URL BUTTONS SETTING =====
    bot.action(/^SET_WELCOME_BUTTONS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const payload = `group-help-advance:btn-design`;
        const miniAppLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encode_payload(payload)}`;

        const textMsg =
            `👉🏻 <b>Send now the Buttons</b> you want to set.\n\n` +
            `If you need a visual tool to build the buttons and get the exact code, ` +
            `<a href="${miniAppLink}">Click Here</a>.`;

        const buttons = [
            [Markup.button.callback("🚫 Remove Keyboard", `REMOVE_WELCOME_BUTTONS_${chatIdStr}`)],
            [Markup.button.callback("❌ Cancel", `CUSTOMIZE_WELCOME_${chatIdStr}`)]
        ];

        await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(buttons),
            disable_web_page_preview: true
        });

        ctx.session = ctx.session || {};
        ctx.session.awaitingWelcomeButtons = { chatIdStr, userId };
        await ctx.answerCbQuery();
    });

    bot.action(/^SEE_WELCOME_BUTTONS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const buttonsData = userDoc?.settings?.[chatIdStr]?.welcome?.buttons;

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
                    } else if (content === "del:") {
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
            })

            // back + main
            inlineKeyboard.push([
                Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, "🔠 <b>Saved Buttons:</b>", {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SEE_WELCOME_BUTTONS error:", err);
        }
    });

    // ===== HANDLE INCOMING TEXT SAVE (for welcome text & buttons) =====
    bot.on("text", async (ctx, next) => {
        try {
            // ===== WELCOME TEXT =====
            if (ctx.session?.awaitingWelcomeText) {
                let { chatIdStr, userId } = ctx.session.awaitingWelcomeText;
                const text = ctx.message.text;
                const payload = `group-help-advance:text-message-design-with-placeholders`;
                const miniAppLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encode_payload(payload)}`;

                const invalidPh = findInvalidPlaceholders(text);
                if (invalidPh.length) {
                    await safeEditOrSend(
                        ctx,
                        "❌ Invalid placeholder(s): <code>" + escapeHtml(invalidPh.join(", ")) + "</code>\n\n" +
                        "Please fix it and send again.\n\n" +
                        "Need help ? " + `<a href="${miniAppLink}">Click Here</a>.`,
                        {
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback("❌ Cancel", `CUSTOMIZE_WELCOME_${chatIdStr}`)]
                            ])
                        }
                    );
                    return;
                }

                // Strict validation: block unsupported/invalid HTML before saving
                const strict = validateTelegramHtmlStrict(text);
                if (!strict.ok) {
                    const top = strict.errors.slice(0, 10).map((e, i) => `${i + 1}. ${e}`).join('\n');
                    await safeEditOrSend(
                        ctx,
                        "❌ Invalid welcome text (HTML).\n" +
                        "Please fix it and send again.\n\n" +
                        `Mistakes:\n${escapeHtml(top)}\n\n` +
                        "Need help ? " + `<a href="${miniAppLink}">Click Here</a>.`,
                        {
                            parse_mode: "HTML",
                            disable_web_page_preview: true,
                            ...Markup.inlineKeyboard([
                                [Markup.button.callback("❌ Cancel", `CUSTOMIZE_RULES_${chatIdStr}`)]
                            ])
                        }
                    );
                    // keep session so user can resend corrected text
                    return;
                }

                // Telegram-side validation (final authority)
                try {
                    await _validateWithTelegramOrThrow(ctx, text);
                } catch (err) {
                    if (_isTelegramHtmlParseError(err)) {
                        await safeEditOrSend(
                            ctx,
                            "❌ Telegram can't parse your welcome text (invalid HTML).\n" +
                            `Mistake: ${(err?.response?.description || err?.description || "Bad HTML").toString()}\n\n` +
                            "Please send a valid HTML message." + "\n\nNeed help ? " + `<a href="${miniAppLink}">Click Here</a>.`,
                            {
                                parse_mode: "HTML",
                                disable_web_page_preview: true,
                                reply_markup: {
                                    inline_keyboard: [
                                        [Markup.button.callback("❌ Cancel", `CUSTOMIZE_WELCOME_${chatIdStr}`)]
                                    ]
                                }
                            }
                        );
                        return;
                    }
                    throw err;
                }


                // validate owner (also returns chat info)
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingWelcomeText;
                    return;
                }

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.welcome.text`]: text,
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Welcome text saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
                // clear previous preview message if any
                if (ctx?.session?.set_welcome_message_id) {
                    try {
                        await ctx.deleteMessage(ctx.session.set_welcome_message_id);
                        delete ctx.session.set_welcome_message_id;
                    } catch (e) {
                        console.log("Message delete error:", e.message);
                    }
                }
                delete ctx.session.awaitingWelcomeText;
                return;
            }

            // ===== WELCOME BUTTONS =====
            if (ctx.session?.awaitingWelcomeButtons) {
                let { chatIdStr, userId } = ctx.session.awaitingWelcomeButtons;
                const raw = (ctx.message.text || "").trim();

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingWelcomeButtons;
                    return;
                }

                const res = await parseButtonsSyntax(ctx, raw);
                if (!res.match) {
                    return;
                }

                const parsedButtons = res.buttons; // expected: array of rows, each row array of { text, url }

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.welcome.buttons`]: parsedButtons,
                            [`settings.${chatIdStr}.welcome.enabled`]: true
                        }
                    },
                    { upsert: true }
                );

                const successMsg = `✅ <b>Buttons saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
                // clear previous preview message if any
                if (ctx?.session?.set_welcome_message_id) {
                    try {
                        await ctx.deleteMessage(ctx.session.set_welcome_message_id);
                        delete ctx.session.set_welcome_message_id;
                    } catch (e) {
                        console.log("Message delete error:", e.message);
                    }
                }
                delete ctx.session.awaitingWelcomeButtons;
                return;
            }
        } catch (err) {
            console.error("❌ Error in incoming text handler (welcome):", err);
            try { await ctx.reply("⚠️ Something went wrong while saving. Please try again."); } catch { }
            if (ctx.session?.awaitingWelcomeText) delete ctx.session.awaitingWelcomeText;
            if (ctx.session?.awaitingWelcomeButtons) delete ctx.session.awaitingWelcomeButtons;
        }

        if (typeof next === "function") {
            await next();
        }
    });

    // ===== HANDLE INCOMING MEDIA SAVE (photo/video/document) =====
    bot.on(["photo", "video", "document"], async (ctx, next) => {
        try {
            if (!ctx.session || !ctx.session.awaitingWelcomeMedia) return typeof next === "function" ? await next() : undefined;;

            let { chatIdStr, userId } = ctx.session.awaitingWelcomeMedia;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                delete ctx.session.awaitingWelcomeMedia;
                return;
            }

            let fileId = null;
            let mediaType = null;
            let caption = "";

            if (ctx.message.photo) {
                fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
                mediaType = "photo";
                caption = ctx.message.caption || "";
            } else if (ctx.message.video) {
                fileId = ctx.message.video.file_id;
                mediaType = "video";
                caption = ctx.message.caption || "";
            } else if (ctx.message.document) {
                fileId = ctx.message.document.file_id;
                mediaType = "document";
                caption = ctx.message.caption || "";
            }

            if (!fileId) {
                await ctx.reply("⚠️ Could not extract file. Try sending again.");
                delete ctx.session.awaitingWelcomeMedia;
                return;
            }

            // --- Save structured media object under welcome.message.media (NOT welcome.media) ---
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.welcome.media`]: fileId,
                        [`settings.${chatIdStr}.welcome.media_type`]: mediaType,
                    }
                },
                { upsert: true, new: true }
            );

            const buttons = [
                [Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ];

            const successCaption = `✅ <b>Welcome media saved</b> for <b>${chat.title || chatIdStr}</b>.`;

            await ctx.reply(successCaption, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
            // clear previous preview message if any
            if (ctx?.session?.set_welcome_message_id) {
                try {
                    await ctx.deleteMessage(ctx.session.set_welcome_message_id);
                    delete ctx.session.set_welcome_message_id;
                } catch (e) {
                    console.log("Message delete error:", e.message);
                }
            }
            delete ctx.session.awaitingWelcomeMedia;
        } catch (err) {
            console.error("❌ Error in incoming media handler (welcome):", err);
            try { await ctx.reply("⚠️ Something went wrong while saving the media. Please try again."); } catch { }
            if (ctx.session?.awaitingWelcomeMedia) delete ctx.session.awaitingWelcomeMedia;
        }

        if (typeof next === "function") {
            await next();
        }
    });

    // ===== FULL PREVIEW WELCOME =====
    bot.action(/^PREVIEW_WELCOME_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const welcome = userDoc?.settings?.[chatIdStr]?.welcome || {};
        if (!welcome) {
            return ctx.answerCbQuery("❌ No welcome saved yet!", { show_alert: true });
        }

        // Build inline keyboard from saved user buttons
        let inlineKeyboard = [];
        if (welcome.buttons && welcome.buttons.length) {
            let row = [];
            welcome.buttons.forEach((row) => {
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
                    } else if (content === "del:") {
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

        // ====== 1) Send welcome preview (media or text) ======
        if (welcome.media) {
            try {
                if (welcome.media_type === "photo") {
                    await ctx.replyWithPhoto(welcome.media, {
                        caption: welcome.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } else if (welcome.media_type === "video") {
                    await ctx.replyWithVideo(welcome.media, {
                        caption: welcome.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                } else if (welcome.media_type === "document") {
                    await ctx.replyWithDocument(welcome.media, {
                        caption: welcome.text || "",
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: inlineKeyboard }
                    });
                }
            } catch (err) {
                console.error("Preview send failed:", err);
            }
        }

        if (!(welcome.buttons && welcome.buttons.length) && !welcome.media) {
            ctx.reply(welcome.text, { parse_mode: "HTML" });
        }

        await ctx.answerCbQuery();
    });

    // ===== REMOVE TEXT =====
    bot.action(/^REMOVE_WELCOME_TEXT_(-?\d+)$/, async (ctx) => {
        ctx.session = {};
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.welcome.text`]: "" } },
                { new: true }
            );

            // check if anything remains to keep welcome.enabled
            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const welcome = refreshed?.settings?.[chatIdStr]?.welcome || {};
            const msg = welcome.message || {};
            const stillHas = !!(msg.text || (msg.media && msg.media.file_id) || (Array.isArray(msg.buttons) && msg.buttons.length));

            if (!stillHas) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.welcome.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ <b>Welcome text removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("Error removing welcome text:", err);
            await ctx.reply("⚠️ Something went wrong while removing the text. Try again.");
        }
    });

    // ===== REMOVE MEDIA =====
    bot.action(/^REMOVE_WELCOME_MEDIA_(-?\d+)$/, async (ctx) => {
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
                        [`settings.${chatIdStr}.welcome.media`]: "",
                        [`settings.${chatIdStr}.welcome.media_type`]: "",
                    }
                },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const welcome = refreshed?.settings?.[chatIdStr]?.welcome || {};
            const msg = welcome.message || {};
            const stillHas = !!(msg.text || (msg.media && msg.media.file_id) || (Array.isArray(msg.buttons) && msg.buttons.length));

            if (!stillHas) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.welcome.enabled`]: false } }
                );
            }

            await safeEditOrSend(ctx, `✅ <b>Welcome media removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("Error removing welcome media:", err);
            await ctx.reply("⚠️ Something went wrong while removing the media. Try again.");
        }
    });

    // ===== REMOVE BUTTONS =====
    bot.action(/^REMOVE_WELCOME_BUTTONS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!chat) return;

        try {
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.welcome.buttons`]: [] } },
                { new: true }
            );

            const refreshed = await user_setting_module.findOne({ user_id: userId }).lean();
            const welcome = refreshed?.settings?.[chatIdStr]?.welcome || {};

            await safeEditOrSend(ctx, `✅ <b>Welcome buttons removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CUSTOMIZE_WELCOME_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("Error removing welcome buttons:", err);
            await ctx.reply("⚠️ Something went wrong while removing the buttons. Try again.");
        }
    });
};