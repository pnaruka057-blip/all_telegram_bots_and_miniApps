const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");

// Language registry
const LANGS = {
    arabic: { key: "arabic", label: "Arabic", emoji: "🕉" },
    cyrillic: { key: "cyrillic", label: "Cyrillic", emoji: "🇷🇺" },
    chinese: { key: "chinese", label: "Chinese", emoji: "🇨🇳" },
    latin: { key: "latin", label: "Latin", emoji: "🔤" }
};

// Penalty label
function penaltyDisplay(p) {
    if (!p) return "Off";
    if (p === "off") return "Off";
    if (p === "warn") return "Warn";
    if (p === "kick") return "Kick";
    if (p === "mute") return "Mute";
    if (p === "ban") return "Ban";
    return p;
}

// ms -> friendly fallback
function msToFallbackMinutes(ms) {
    if (typeof ms !== "number" || Number.isNaN(ms)) return null;
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} days`;
    const months = Math.floor(days / 30);
    return `${months} months`;
}

// Parse flexible duration text -> total seconds
function parseDurationToSeconds(input) {
    if (!input || typeof input !== "string") return null;
    const txt = input.trim().toLowerCase();

    // plain number = minutes
    if (/^\d+$/.test(txt)) {
        const minutes = parseInt(txt, 10);
        return minutes * 60;
    }

    const unitSeconds = {
        year: 365 * 24 * 3600, years: 365 * 24 * 3600, yr: 365 * 24 * 3600, y: 365 * 24 * 3600,
        month: 30 * 24 * 3600, months: 30 * 24 * 3600, mo: 30 * 24 * 3600,
        week: 7 * 24 * 3600, weeks: 7 * 24 * 3600, w: 7 * 24 * 3600,
        day: 24 * 3600, days: 24 * 3600, d: 24 * 3600,
        hour: 3600, hours: 3600, hr: 3600, h: 3600,
        minute: 60, minutes: 60, min: 60, mins: 60, m: 60,
        second: 1, seconds: 1, sec: 1, secs: 1, s: 1
    };

    const re = /(\d+)\s*(years?|yrs?|y|months?|mos?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/gi;
    let match;
    let total = 0;
    let found = false;
    while ((match = re.exec(txt)) !== null) {
        found = true;
        const num = parseInt(match[1], 10);
        const unitRaw = (match[2] || "").toLowerCase();
        let key = unitRaw;
        if (key.startsWith("yr") || key === "y") key = "year";
        else if (key.startsWith("mo") && key !== "m") key = "month";
        else if (key === "m") key = "m";
        else if (key.startsWith("min")) key = "minute";
        else if (key.startsWith("sec")) key = "second";
        else if (key.startsWith("hr")) key = "hour";
        else if (key.startsWith("week")) key = "week";
        else if (key.startsWith("day")) key = "day";
        else if (key.startsWith("hour")) key = "hour";
        else if (key.startsWith("month")) key = "month";
        else if (key.startsWith("year")) key = "year";

        const factor = unitSeconds[key];
        if (!factor) return null;
        total += num * factor;
    }

    if (!found) return null;
    return total;
}

// Render main menu
async function renderAlphabetsMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const alph = userDoc?.settings?.[chatIdStr]?.alphabets || {};

    let text =
        `🕉 <b>Alphabets</b>\n\n` +
        `Select punishment for any user who sends messages written in certain alphabets.\n\n`;

    for (const key of Object.keys(LANGS)) {
        const L = LANGS[key];
        const entry = alph?.[key] || {};
        // unified fields for duration penalties
        const rawDur = entry?.penalty_duration_str
        const numDur = typeof entry?.penalty_duration === "number"
            ? entry.penalty_duration
            : undefined; // legacy fallback

        const durDisplay = rawDur
            ? ` ${rawDur}`
            : (typeof numDur === "number" ? ` ${msToFallbackMinutes(numDur)}` : " Always");

        const pen = (entry.penalty || "off").toLowerCase();
        const deleteMsg = entry.delete_messages ? "On" : "Off";
        const status = ["warn", "mute", "ban"].includes(pen)
            ? `${penaltyDisplay(pen)}${durDisplay}`
            : penaltyDisplay(pen);

        text += `${L.emoji} <b>${L.label}</b>\n└ Status: ${status} | Delete: ${deleteMsg}\n\n`;
    }

    const rows = [];
    const keys = Object.keys(LANGS);
    for (let i = 0; i < keys.length; i += 2) {
        const left = keys[i];
        const right = keys[i + 1];
        const row = [];
        row.push(Markup.button.callback(`${LANGS[left].emoji} ${LANGS[left].label}`, `ALPHABETS_LANG_${left}_${chatIdStr}`));
        if (right) row.push(Markup.button.callback(`${LANGS[right].emoji} ${LANGS[right].label}`, `ALPHABETS_LANG_${right}_${chatIdStr}`));
        rows.push(row);
    }
    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Render per-language menu
async function renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey) {
    const L = LANGS[langKey];
    if (!L) return;

    const ok = "✅";
    const no = "❌";

    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const entry = userDoc?.settings?.[chatIdStr]?.alphabets?.[langKey] || {};
    const pen = (entry.penalty || "off").toLowerCase();

    const rawDur = entry?.penalty_duration_str || 'None';

    const deleteMsgFlag = Boolean(entry.delete_messages);
    const deleteMsgStatus = deleteMsgFlag ? `On ${ok}` : `Off ${no}`;

    // Build base text without unconditional duration
    let text =
        `${L.emoji} <b>${L.label}</b>\n\n` +
        `Select penalty for users sending messages in <b>${L.label}</b> alphabet.\n\n` +
        `Penalty: <b>${penaltyDisplay(pen)}</b>\n` +
        `Delete message: <b>${deleteMsgStatus}</b>\n\n`;

    // Show duration and permanence note ONLY for warn/mute/ban
    if (["warn", "mute", "ban"].includes(pen)) {
        text += `<b>Penalty duration:</b> ${rawDur || "None"}\n\n`;
        text += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n\n`;
    }

    const deleteButtonLabel = deleteMsgFlag ? `Delete previous message ${ok}` : `Delete previous message ${no}`;

    const buttons = [
        [
            Markup.button.callback("❌ Off", `ALPHABETS_SET_PUNISH_off_${langKey}_${chatIdStr}`),
            Markup.button.callback("❗ Warn", `ALPHABETS_SET_PUNISH_warn_${langKey}_${chatIdStr}`)
        ],
        [
            Markup.button.callback("❗ Kick", `ALPHABETS_SET_PUNISH_kick_${langKey}_${chatIdStr}`),
            Markup.button.callback("🔕 Mute", `ALPHABETS_SET_PUNISH_mute_${langKey}_${chatIdStr}`),
            Markup.button.callback("⛔ Ban", `ALPHABETS_SET_PUNISH_ban_${langKey}_${chatIdStr}`)
        ],
        [Markup.button.callback(deleteButtonLabel, `ALPHABETS_TOGGLE_DELETE_${langKey}_${chatIdStr}`)]
    ];

    if (["warn", "mute", "ban"].includes(pen)) {
        buttons.push([Markup.button.callback(`⏲️ Set ${penaltyDisplay(pen)} Duration (${rawDur})`, `ALPHABETS_SET_DURATION_${langKey}_${chatIdStr}_${pen}`)]);
    }

    buttons.push([Markup.button.callback("⬅️ Back", `SET_ALPHABETS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    text += `<i>Select one of the options below to change the settings.</i>`;

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
}

// Module export
module.exports = (bot) => {
    // Open alphabets menu
    bot.action(/^SET_ALPHABETS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderAlphabetsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ALPHABETS error:", err);
        }
    });

    // Open specific language submenu
    bot.action(/^ALPHABETS_LANG_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_LANG error:", err);
        }
    });

    // Set punishment for language, with default duration for warn/mute/ban if missing
    bot.action(/^ALPHABETS_SET_PUNISH_(off|warn|kick|mute|ban)_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const punish = ctx.match[1].toLowerCase();
            const langKey = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // if selecting a duration-based penalty and duration missing -> set defaults
            if (["warn", "mute", "ban"].includes(punish)) {
                const doc = await user_setting_module.findOne({ user_id: userId }).lean();
                const entry = doc?.settings?.[chatIdStr]?.alphabets?.[langKey] || {};
                const hasDuration = !!entry.penalty_duration_str
                if (!hasDuration) {
                    await user_setting_module.findOneAndUpdate(
                        { user_id: userId },
                        {
                            $set: {
                                [`settings.${chatIdStr}.alphabets.${langKey}.penalty_duration_str`]: "10 minutes",
                                [`settings.${chatIdStr}.alphabets.${langKey}.penalty_duration`]: 600000
                            }
                        },
                        { upsert: true, setDefaultsOnInsert: true }
                    );
                }
            }

            // set penalty
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.alphabets.${langKey}.penalty`]: punish } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Punishment for ${LANGS[langKey].label} set to: ${punish}`);
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_SET_PUNISH error:", err);
        }
    });

    // Toggle delete previous message
    bot.action(/^ALPHABETS_TOGGLE_DELETE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = userDoc?.settings?.[chatIdStr]?.alphabets?.[langKey]?.delete_messages;
            const newVal = !Boolean(cur);

            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.alphabets.${langKey}.delete_messages`]: newVal } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete previous message: ${newVal ? "On" : "Off"}`);
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_TOGGLE_DELETE error:", err);
            try { await ctx.answerCbQuery("Failed to toggle delete message."); } catch (_) { }
        }
    });

    // Open Set Duration prompt for current penalty (warn/mute/ban)
    bot.action(/^ALPHABETS_SET_DURATION_([a-z]+)_(-?\d+)_(warn|mute|ban)$/i, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const kind = ctx.match[3].toLowerCase();
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingAlphabetDuration = { chatIdStr, userId, langKey, kind, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.alphabets?.[langKey] || {};
            const current = entry?.penalty_duration_str
                || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for ${kind.toUpperCase()} punishment</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ALPHABETS_REMOVE_DURATION_${langKey}_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ALPHABETS_CANCEL_DURATION_${langKey}_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery?.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message?.message_id) {
                promptChatId = ctx.chat?.id ?? null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session?.awaitingAlphabetDuration) {
                ctx.session.awaitingAlphabetDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("ALPHABETS_SET_DURATION action error:", err);
        }
    });

    // Remove duration -> permanent
    bot.action(/^ALPHABETS_REMOVE_DURATION_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.alphabets.${langKey}.penalty_duration_str`]: "",
                        [`settings.${chatIdStr}.alphabets.${langKey}.penalty_duration`]: ""
                    }
                }
            );

            if (ctx.session?.awaitingAlphabetDuration) delete ctx.session.awaitingAlphabetDuration;

            await ctx.answerCbQuery("🗑️ Duration removed (punishment becomes permanent)");
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_REMOVE_DURATION error:", err);
            try { await ctx.answerCbQuery("Failed to remove duration."); } catch (_) { }
        }
    });

    // Cancel duration setting
    bot.action(/^ALPHABETS_CANCEL_DURATION_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            if (ctx.session?.awaitingAlphabetDuration) delete ctx.session.awaitingAlphabetDuration;
            await ctx.answerCbQuery("❌ Cancelled");
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_CANCEL_DURATION error:", err);
            try { await ctx.answerCbQuery("Failed to cancel."); } catch (_) { }
        }
    });

    // Collect duration input and save
    bot.on("text", async (ctx, next) => {
        try {
            const st = ctx.session?.awaitingAlphabetDuration;
            if (!st) return next();

            const { chatIdStr, userId, langKey, kind } = st;
            if (ctx.from.id !== userId) return; // only same admin

            const txt = (ctx.message.text || "").trim();
            if (!txt) {
                await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return;
            }

            const seconds = parseDurationToSeconds(txt);
            if (!seconds) {
                await ctx.reply("❌ Couldn't parse duration. Use format like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return;
            }

            const MIN_SECONDS = 30;
            const MAX_SECONDS = 365 * 24 * 3600;
            if (seconds < MIN_SECONDS) {
                await ctx.reply("❌ Duration is too short. Minimum is 30 seconds.");
                return;
            }
            if (seconds > MAX_SECONDS) {
                await ctx.reply("❌ Duration is too long. Maximum is 365 days.");
                return;
            }

            const ms = seconds * 1000;

            // Save unified fields; keep selected penalty
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.alphabets.${langKey}.penalty_duration_str`]: txt,
                        [`settings.${chatIdStr}.alphabets.${langKey}.penalty_duration`]: ms,
                        [`settings.${chatIdStr}.alphabets.${langKey}.penalty`]: kind // ensure matches current kind
                    }
                },
                { upsert: true }
            );

            // Cleanup prompt
            try {
                const msg = st.promptMessage;
                if (msg?.chatId && msg?.messageId) {
                    try { await ctx.telegram.deleteMessage(msg.chatId, msg.messageId); } catch (_) { }
                }
            } catch (_) { }

            ctx.session.awaitingAlphabetDuration = null;

            await ctx.reply(`✅ Duration for ${LANGS[langKey].label} (${kind.toUpperCase()}) set to ${txt}.`);
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
            return;
        } catch (err) {
            console.error("ALPHABETS duration input error:", err);
            return next();
        }
    });
};
