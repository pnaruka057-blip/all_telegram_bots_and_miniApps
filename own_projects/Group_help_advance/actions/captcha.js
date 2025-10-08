// handlers/captcha.js (complete module with no penalty_duration usage)
const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const formatMs = require('../helpers/format_ms_to_min_sec');

const MODES = {
    button: { id: "button", label: "Button", emoji: "1️⃣" },
    recaptcha: { id: "recaptcha", label: "Recaptcha", emoji: "2️⃣" },
    presentation: { id: "presentation", label: "Presentation", emoji: "3️⃣" },
    regulation: { id: "regulation", label: "Regulation", emoji: "4️⃣" },
    math: { id: "math", label: "Math", emoji: "5️⃣" },
    quiz: { id: "quiz", label: "Quiz", emoji: "6️⃣" }
};

// Render menu (time/time_str in ms; no penalty_duration usage)
async function renderCaptchaMenu(ctx, chatIdStr, userId) {
    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const c = userDoc?.settings?.[chatIdStr]?.captcha || {};

    const enabled = !!c.enabled;
    const timeMs = typeof c.time === "number" ? c.time
        : (typeof c.time_ms === "number" ? c.time_ms // legacy fallback if exists
            : 10 * 60 * 1000);
    const timeStr = (typeof c.time_str === "string" && c.time_str.trim().length) ? c.time_str : formatMs(timeMs);
    const penalty = (c.penalty || "off").toLowerCase();
    const mode = c.mode || "quiz";
    const deleteSvc = !!c.delete_service_message;

    const ok = "✅";
    const no = "❌";

    if (!enabled) {
        const text =
            `🧠 <b>Captcha</b>\n\n` +
            `By activating the captcha, when a user enters the group he will not be able to send messages until he has confirmed that he is not a robot.\n\n` +
            `⏱️ You can also decide to set a PUNISHMENT down below for those who will not resolve the captcha within the desired time and whether or not to clear the service message in case of failure.\n\n` +
            `<b>Status</b>: Off ${no}`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("✅ Turn on", `CAPTCHA_TURN_ON_${chatIdStr}`), Markup.button.callback("❌ Turn off", `CAPTCHA_TURN_OFF_${chatIdStr}`)],
            [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
        ]);

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
        return;
    }

    const penaltyText = penalty === "off" ? "Off" : penalty.charAt(0).toUpperCase() + penalty.slice(1);

    const text =
        `🧠 <b>Captcha</b>\n\n` +
        `By activating the captcha, when a user enters the group he will not be able to send messages until he has confirmed that he is not a robot.\n\n` +
        `⏱️ You can also decide to set a PUNISHMENT down below for those who will not resolve the captcha within the desired time and whether or not to clear the service message in case of failure.\n\n` +
        `<b>Status</b>: On ${ok}\n` +
        `<b>Time</b>: ${timeStr} (${timeMs} ms)\n` +
        `<b>Penalty</b>: ${penaltyText}\n` +
        `<b>Mode</b>: ${mode.charAt(0).toUpperCase() + mode.slice(1)}\n` +
        `<b>Delete service message</b>: ${deleteSvc ? "On " + ok : "Off " + no}` +
        `\n\n<i>Select one of the options below to change the settings for <b>${isOwner ? isOwner.title : chatIdStr}</b>.</i>`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("✅ Turn on", `CAPTCHA_TURN_ON_${chatIdStr}`), Markup.button.callback("❌ Turn off", `CAPTCHA_TURN_OFF_${chatIdStr}`)],
        [Markup.button.callback("📦 Mode", `CAPTCHA_MODE_${chatIdStr}`), Markup.button.callback("⏱ Time", `CAPTCHA_TIME_${chatIdStr}`)],
        [Markup.button.callback("⛔ Penalty", `CAPTCHA_PENALTY_${chatIdStr}`)],
        [Markup.button.callback("✍️ Customize Message", `CAPTCHA_CUSTOMIZE_${chatIdStr}`)],
        [Markup.button.callback("📚 Select a Topic", `CAPTCHA_TOPIC_${chatIdStr}`)],
        [Markup.button.callback(deleteSvc ? "🗑️ Delete service message ✅" : "🗑️ Delete service message ❌", `CAPTCHA_TOGGLE_DELETE_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
}

module.exports = (bot) => {
    // Open captcha menu
    bot.action(/^SET_CAPTCHA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_CAPTCHA error:", err);
        }
    });

    // Turn on (defaults; no penalty_duration fields)
    bot.action(/^CAPTCHA_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: {
                        [`settings.${chatIdStr}.captcha.enabled`]: true,
                        [`settings.${chatIdStr}.captcha.time`]: 10 * 60 * 1000,
                        [`settings.${chatIdStr}.captcha.time_str`]: "10 minutes",
                        [`settings.${chatIdStr}.captcha.penalty`]: "mute",
                        [`settings.${chatIdStr}.captcha.mode`]: "quiz",
                        [`settings.${chatIdStr}.captcha.delete_service_message`]: false
                    }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("Captcha activated.");
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_TURN_ON error:", err);
        }
    });

    // Turn off
    bot.action(/^CAPTCHA_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                { $set: { [`settings.${chatIdStr}.captcha.enabled`]: false } },
                { upsert: true }
            );

            await ctx.answerCbQuery("Captcha turned off.");
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_TURN_OFF error:", err);
        }
    });

    // Mode selection grid with mode explanations
    bot.action(/^CAPTCHA_MODE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const curMode = userDoc?.settings?.[chatIdStr]?.captcha?.mode || "quiz";

            const text =
                `<b>🔄 CAPTCHA Mode</b>\n\n` +
                `Current mode: <b>${curMode.charAt(0).toUpperCase() + curMode.slice(1)}</b>\n\n` +
                `<b>Modes explained:</b>\n` +
                `${MODES.button.emoji} <b>Button</b> — The user just clicks a simple button and will be unmuted immediately upon click.\n` +
                `${MODES.recaptcha.emoji} <b>Recaptcha</b> — The user presses a button and a web page opens (closes immediately) where Cloudflare Turnstile verifies the user.\n` +
                `${MODES.presentation.emoji} <b>Presentation</b> — The user must send a text message to the group within the set time.\n` +
                `${MODES.regulation.emoji} <b>Regulation</b> — The group regulation is shown and the user must accept it in time; otherwise the captcha penalty is applied.\n` +
                `${MODES.math.emoji} <b>Math</b> — The user must solve a simple math quiz.\n` +
                `${MODES.quiz.emoji} <b>Quiz</b> — The user must answer a question correctly.\n\n` +
                `<i>Choose captcha mode for this chat.</i>\n\n`;

            const rows = [];
            const entries = Object.entries(MODES);
            for (let i = 0; i < entries.length; i += 2) {
                const left = entries[i];
                const right = entries[i + 1];

                const leftKey = left[0];
                const leftMeta = left[1];
                const leftLabel = `${leftMeta.emoji} ${leftMeta.label}${curMode === leftKey ? " ✅" : ""}`;

                const row = [Markup.button.callback(leftLabel, `CAPTCHA_SET_MODE_${leftKey}_${chatIdStr}`)];

                if (right) {
                    const rightKey = right[0];
                    const rightMeta = right[1];
                    const rightLabel = `${rightMeta.emoji} ${rightMeta.label}${curMode === rightKey ? " ✅" : ""}`;
                    row.push(Markup.button.callback(rightLabel, `CAPTCHA_SET_MODE_${rightKey}_${chatIdStr}`));
                }

                rows.push(row);
            }

            rows.push([Markup.button.callback("⬅️ Back", `SET_CAPTCHA_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
        } catch (err) {
            console.error("CAPTCHA_MODE error:", err);
        }
    });

    // Set selected mode
    bot.action(/^CAPTCHA_SET_MODE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const chosen = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            if (!MODES[chosen]) {
                await ctx.answerCbQuery("Unknown mode.");
                return;
            }

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.captcha.mode`]: chosen }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Mode set to: ${MODES[chosen].label}`);
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_SET_MODE error:", err);
        }
    });

    // Toggle delete service message
    bot.action(/^CAPTCHA_TOGGLE_DELETE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.captcha?.delete_service_message;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.captcha.delete_service_message`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete service message: ${newVal ? "On ✅" : "Off ❌"}`);
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_TOGGLE_DELETE error:", err);
        }
    });

    // CAPTCHA_TIME: seconds 30..59 and minutes 1..50
    bot.action(/^CAPTCHA_TIME_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const c = userDoc?.settings?.[chatIdStr]?.captcha || {};
            const currentMs = typeof c.time === "number" ? c.time
                : (typeof c.time_ms === "number" ? c.time_ms
                    : 10 * 60 * 1000);

            const header =
                `<b>⌛ Captcha Timeout.</b>\n\n` +
                `Currently: <b>${formatMs(currentMs)}</b> (${currentMs} ms).\n\n` +
                `If the new member does not solve the captcha within the selected time, the configured penalty will be applied permanently.\n` +
                `They will get a second chance only if the selected penalty is not <b>Ban</b>; if <b>Ban</b> is applied, they must be unbanned by an admin before they can rejoin and attempt the captcha again.\n\n` +
                `<i>Choose seconds (30–59) or minutes (1–50):</i>`;

            const keyboardRows = [];
            let row = [];
            for (let s = 30; s <= 59; s++) {
                row.push(Markup.button.callback(`${s}s`, `CAPTCHA_SET_TIME_SEC_${s}_${chatIdStr}`));
                if (row.length === 6) {
                    keyboardRows.push(row);
                    row = [];
                }
            }
            if (row.length) keyboardRows.push(row);

            keyboardRows.push([Markup.button.callback("— Minutes —", `CAPTCHA_TIME_NOP_${chatIdStr}`)]);

            row = [];
            for (let m = 1; m <= 50; m++) {
                row.push(Markup.button.callback(`${m}m`, `CAPTCHA_SET_TIME_MIN_${m}_${chatIdStr}`));
                if (row.length === 5) {
                    keyboardRows.push(row);
                    row = [];
                }
            }
            if (row.length) keyboardRows.push(row);

            keyboardRows.push([Markup.button.callback("⬅️ Back", `SET_CAPTCHA_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

            await safeEditOrSend(ctx, header, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: keyboardRows }
            });
        } catch (err) {
            console.error("CAPTCHA_TIME error:", err);
        }
    });

    bot.action(/^CAPTCHA_TIME_NOP_(-?\d+)$/, async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (err) { /* ignore */ }
    });

    // Set seconds -> write time (ms) + time_str
    bot.action(/^CAPTCHA_SET_TIME_SEC_(\d+)_(-?\d+)$/, async (ctx) => {
        try {
            const sec = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const ms = sec * 1000;

            const userIdKey = userId;
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: {
                        [`settings.${chatIdStr}.captcha.time`]: ms,
                        [`settings.${chatIdStr}.captcha.time_str`]: `${sec} seconds`
                    }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`✅ Timeout set: ${formatMs(ms)}`, { show_alert: true });
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_SET_TIME_SEC error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (_) { }
        }
    });

    // Set minutes -> write time (ms) + time_str
    bot.action(/^CAPTCHA_SET_TIME_MIN_(\d+)_(-?\d+)$/, async (ctx) => {
        try {
            const min = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const ms = min * 60 * 1000;

            const userIdKey = userId;
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: {
                        [`settings.${chatIdStr}.captcha.time`]: ms,
                        [`settings.${chatIdStr}.captcha.time_str`]: `${min} minutes`
                    }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`✅ Timeout set: ${formatMs(ms)}`, { show_alert: true });
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_SET_TIME_MIN error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (_) { }
        }
    });

    // Penalty chooser (no duration logic) with explanation
    bot.action(/^CAPTCHA_PENALTY_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const rows = [
                [Markup.button.callback("❗ Kick", `CAPTCHA_SET_PEN_kick_${chatIdStr}`)],
                [Markup.button.callback("🔕 Mute", `CAPTCHA_SET_PEN_mute_${chatIdStr}`)],
                [Markup.button.callback("⛔ Ban", `CAPTCHA_SET_PEN_ban_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `SET_CAPTCHA_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ];

            const text =
                "<b>🚨 Penalty for CAPTCHA Failures.\n\n</b>" +
                "The selected penalty will be applied if the member answers the captcha incorrectly or does not solve it within the selected time. It remains in effect until the member leaves the group and joins again to get another attempt.\n\n" +
                "<i>Select the penalty:</i>";

            await safeEditOrSend(ctx, text, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: rows }
            });
        } catch (err) {
            console.error("CAPTCHA_PENALTY error:", err);
        }
    });

    // Set chosen penalty (no duration defaults)
    bot.action(/^CAPTCHA_SET_PEN_(kick|mute|ban)_(\-?\d+)$/, async (ctx) => {
        try {
            const pen = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.captcha.penalty`]: pen }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Penalty set to: ${pen}`);
            await renderCaptchaMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CAPTCHA_SET_PEN error:", err);
        }
    });

    // Customize message
    bot.action(/^CAPTCHA_CUSTOMIZE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const msg = userDoc?.settings?.[chatIdStr]?.captcha || {};
            const hasText = !!(msg.message && msg.message.trim());
            const hasButton_text = msg.button_text && msg.button_text.length > 0;

            const text =
                `✍️ <b>Customize message</b>\n\n` +
                `Here you can set the service message that will be shown with the captcha (text and optional button text).\n\n` +
                `<b>How it works:</b>\n` +
                `• If no custom <b>text</b> or <b>button text</b> is set, the default captcha message will be sent.\n` +
                `• If custom <b>text</b> and/or <b>button text</b> are set, those will be used instead of the default.\n` +
                `• If only one of <b>text</b> or <b>button text</b> is set, the set value will be used together with the default for the other.\n\n` +
                `<i>Use the options below to add or preview your custom message and button.</i>`;

            const keyboard = Markup.inlineKeyboard([
                [
                    Markup.button.callback("📄 Text", `SET_CAPTCHA_MESSAGE_TEXT_${chatIdStr}`),
                    Markup.button.callback(hasText ? "👀 See" : "➕ Add", hasText ? `SEE_CAPTCHA_MESSAGE_TEXT_${chatIdStr}` : `SET_CAPTCHA_MESSAGE_TEXT_${chatIdStr}`)
                ],
                [
                    Markup.button.callback("🔠 Button", `SET_CAPTCHA_MESSAGE_BUTTONS_${chatIdStr}`),
                    Markup.button.callback(hasButton_text ? "👀 See" : "➕ Add", hasButton_text ? `SEE_CAPTCHA_MESSAGE_BUTTONS_${chatIdStr}` : `SET_CAPTCHA_MESSAGE_BUTTONS_${chatIdStr}`)
                ],
                [
                    Markup.button.callback("⬅️ Back", `SET_CAPTCHA_${chatIdStr}`),
                    Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                ]
            ]);

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
            await ctx.answerCbQuery();
        } catch (err) {
            console.error("CAPTCHA_CUSTOMIZE error:", err);
            try { await ctx.answerCbQuery("⚠️ Error opening customize menu"); } catch (_) { }
        }
    });

    // ===== SET TEXT =====
    bot.action(/^SET_CAPTCHA_MESSAGE_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const textMsg =
                "✍️ <b>Send the service message text you want to set.</b>\n\n" +
                `For message design options (placeholders and HTML), <a href="${process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE}/text-message-design">click here</a>.`;

            const buttons = [
                [Markup.button.callback("🚫 Remove message", `REMOVE_CAPTCHA_MESSAGE_TEXT_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `CAPTCHA_CUSTOMIZE_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, textMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) }, true);

            ctx.session = ctx.session || {};
            const promptMessageId = sent;
            ctx.session.awaitingCaptchaMessageText = { chatIdStr, userId, promptMessageId };

            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SET_CAPTCHA_MESSAGE_TEXT error:", err);
        }
    });

    // ===== SEE TEXT =====
    bot.action(/^SEE_CAPTCHA_MESSAGE_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const text = userDoc?.settings?.[chatIdStr]?.captcha.message;

            if (!text) {
                return ctx.answerCbQuery("❌ No service text set yet!", { show_alert: true });
            }

            await ctx.answerCbQuery();

            await ctx.reply(text, { parse_mode: "HTML" });
        } catch (err) {
            console.error("SEE_CAPTCHA_MESSAGE_TEXT error:", err);
        }
    });

    // ===== REMOVE TEXT =====
    bot.action(/^REMOVE_CAPTCHA_MESSAGE_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.captcha.message`]: "" } },
                { new: true }
            );

            await safeEditOrSend(ctx, `✅ <b>Service text removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CAPTCHA_CUSTOMIZE_${chatIdStr}`)],
                    [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });

            await ctx.answerCbQuery();
        } catch (err) {
            console.error("REMOVE_CAPTCHA_MESSAGE_TEXT error:", err);
            await ctx.reply("⚠️ Something went wrong while removing the text. Try again.");
        }
    });

    // ===== SET BUTTONS (single-button label text) =====
    bot.action(/^SET_CAPTCHA_MESSAGE_BUTTONS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const textMsg =
                "🔠 <b>Send the text for the button:\n\n"

            const buttons = [
                [Markup.button.callback("🚫 Remove Keyboard", `REMOVE_CAPTCHA_MESSAGE_BUTTONS_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `CAPTCHA_CUSTOMIZE_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, textMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) }, true);

            ctx.session = ctx.session || {};
            const promptMessageId = sent;
            ctx.session.awaitingCaptchaMessageButton = { chatIdStr, userId, promptMessageId };

            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SET_CAPTCHA_MESSAGE_BUTTONS error:", err);
        }
    });

    // ===== SEE BUTTONS =====
    bot.action(/^SEE_CAPTCHA_MESSAGE_BUTTONS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const button_text = userDoc?.settings?.[chatIdStr]?.captcha?.button_text;

            if (!button_text || !(typeof button_text === "string") || button_text.trim().length === 0) {
                return ctx.answerCbQuery("❌ No buttons set yet!", { show_alert: true });
            }

            const label = button_text.trim();
            const encoded = Buffer.from(label, "utf8").toString("base64");

            const inlineKeyboard = [
                [Markup.button.callback(label, `CAPTCHA_PREVIEW_BTN_${encoded}_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `CAPTCHA_CUSTOMIZE_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ];

            await safeEditOrSend(ctx, "🔠 <b>Saved Button (preview):</b>", {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: inlineKeyboard }
            });

            await ctx.answerCbQuery();
        } catch (err) {
            console.error("SEE_CAPTCHA_MESSAGE_BUTTONS error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while showing buttons.", { show_alert: true }); } catch (_) { }
        }
    });

    // ===== REMOVE BUTTONS =====
    bot.action(/^REMOVE_CAPTCHA_MESSAGE_BUTTONS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!chat) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.captcha.button_text`]: "" } },
                { new: true }
            );

            await safeEditOrSend(ctx, `✅ <b>Service buttons removed</b> for <b>${chat.title || chatIdStr}</b>.`, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `CAPTCHA_CUSTOMIZE_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ])
            });

            await ctx.answerCbQuery();
        } catch (err) {
            console.error("REMOVE_CAPTCHA_MESSAGE_BUTTONS error:", err);
            await ctx.reply("⚠️ Something went wrong while removing the buttons. Try again.");
        }
    });

    // ===== HANDLE INCOMING TEXT FOR message text & buttons =====
    bot.on("text", async (ctx, next) => {
        try {
            ctx.session = ctx.session || {};

            // CAPTCHA MESSAGE TEXT
            if (ctx.session.awaitingCaptchaMessageText) {
                let { chatIdStr, userId, promptMessageId } = ctx.session.awaitingCaptchaMessageText;
                const text = (ctx.message.text || "").trim();

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) { delete ctx.session.awaitingCaptchaMessageText; return; }

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $set: {
                            [`settings.${chatIdStr}.captcha.message`]: text,
                            [`settings.${chatIdStr}.captcha.enabled`]: true
                        }
                    },
                    { upsert: true }
                );

                if (promptMessageId) {
                    try { await ctx.deleteMessage(promptMessageId); } catch (e) { /* ignore */ }
                }

                const successMsg = `✅ <b>Service message text saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CAPTCHA_CUSTOMIZE_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });

                delete ctx.session.awaitingCaptchaMessageText;
                return;
            }

            // CAPTCHA MESSAGE BUTTON
            if (ctx.session.awaitingCaptchaMessageButton) {
                let { chatIdStr, userId, promptMessageId } = ctx.session.awaitingCaptchaMessageButton;
                const raw = (ctx.message.text || "").trim();

                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) { delete ctx.session.awaitingCaptchaMessageButton; return; }

                if (!raw || raw.length > 200) {
                    await ctx.reply("❌ Invalid button text. Send a short label (max 200 characters).");
                    return;
                }

                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    { $set: { [`settings.${chatIdStr}.captcha.button_text`]: raw } },
                    { upsert: true }
                );

                if (promptMessageId) {
                    try { await ctx.deleteMessage(promptMessageId); } catch (e) { /* ignore */ }
                }

                const successMsg = `✅ <b>Service buttons saved</b> for <b>${chat.title || chatIdStr}</b>.`;
                const buttons = [
                    [Markup.button.callback("⬅️ Back", `CAPTCHA_CUSTOMIZE_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ];

                await ctx.reply(successMsg, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });

                delete ctx.session.awaitingCaptchaMessageButton;
                return;
            }
        } catch (err) {
            console.error("Error in incoming text handler (captcha customize):", err);
            try { await ctx.reply("⚠️ Something went wrong while saving. Please try again."); } catch (_) { }
            if (ctx.session?.awaitingCaptchaMessageText) delete ctx.session.awaitingCaptchaMessageText;
            if (ctx.session?.awaitingCaptchaMessageButton) delete ctx.session.awaitingCaptchaMessageButton;
        }

        if (typeof next === "function") {
            await next();
        }
    });
};
