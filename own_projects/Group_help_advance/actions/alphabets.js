const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");

const LANGS = {
    arabic: { key: "arabic", label: "Arabic", emoji: "🕉" },
    cyrillic: { key: "cyrillic", label: "Cyrillic", emoji: "🇷🇺" },
    chinese: { key: "chinese", label: "Chinese", emoji: "🇨🇳" },
    latin: { key: "latin", label: "Latin", emoji: "🔤" }
};

function penaltyDisplay(p) {
    if (!p) return "Off";
    if (p === "off") return "Off";
    if (p === "warn") return "Warn";
    if (p === "kick") return "Kick";
    if (p === "mute") return "Mute";
    if (p === "ban") return "Ban";
    return p;
}

// helper to pretty-print milliseconds fallback (simple minutes fallback)
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

async function renderAlphabetsMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const alph = userDoc?.settings?.[chatIdStr]?.alphabets || {};

    let text =
        `🕉 <b>Alphabets</b>\n\n` +
        `Select punishment for any user who sends messages written in certain alphabets.\n\n`;

    // show each lang status
    for (const key of Object.keys(LANGS)) {
        const L = LANGS[key];
        const entry = alph?.[key] || {};
        const raw = entry?.mute_duration_str;
        const muteDur = raw
            ? ` ${raw}`
            : (typeof entry.mute_duration === "number" ? ` ${msToFallbackMinutes(entry.mute_duration)}` : " Always");
        const pen = entry.penalty || "off";
        const deleteMsg = entry.delete_messages ? "On" : "Off";
        const status = pen === "mute" ? `${penaltyDisplay(pen)}${muteDur}` : penaltyDisplay(pen);
        text += `${L.emoji} <b>${L.label}</b>\n└ Status: ${status} | Delete: ${deleteMsg}\n\n`;
    }

    // build keyboard
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

async function renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey) {
    const L = LANGS[langKey];
    if (!L) return;

    const ok = "✅";
    const no = "❌";

    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const entry = userDoc?.settings?.[chatIdStr]?.alphabets?.[langKey] || {};
    const pen = entry.penalty || "off";
    const muteRaw = entry?.mute_duration_str ?? (typeof entry.mute_duration === "number" ? msToFallbackMinutes(entry.mute_duration) : null);
    const deleteMsgFlag = Boolean(entry.delete_messages);
    const deleteMsgStatus = deleteMsgFlag ? `On ${ok}` : `Off ${no}`;

    const text =
        `${L.emoji} <b>${L.label}</b>\n\n` +
        `Select punishment for users sending messages in <b>${L.label}</b> alphabet.\n\n` +
        `Punishment: <b>${pen === "mute" ? `Mute ${muteRaw ?? 'Always'}` : penaltyDisplay(pen)}</b>\n` +
        `Delete message: <b>${deleteMsgStatus}</b>`;

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
        // Delete Message toggle button with dynamic label
        [
            Markup.button.callback(deleteButtonLabel, `ALPHABETS_TOGGLE_DELETE_${langKey}_${chatIdStr}`)
        ]
    ];

    if (pen === "mute") {
        buttons.push([Markup.button.callback("⏲️ Set mute duration", `ALPHABETS_SET_MUTE_${langKey}_${chatIdStr}`)]);
    }

    buttons.push([Markup.button.callback("⬅️ Back", `SET_ALPHABETS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
}

function parseDurationToSeconds(input) {
    if (!input || typeof input !== "string") return null;
    const txt = input.trim().toLowerCase();

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

    // Set punishment for language
    bot.action(/^ALPHABETS_SET_PUNISH_(off|warn|kick|mute|ban)_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const punish = ctx.match[1];
            const langKey = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;

            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const curMuteStr = userDoc?.settings?.[chatIdStr]?.alphabets?.[langKey]?.mute_duration_str;
            const upsertObj = { $setOnInsert: { user_id: userIdKey }, $set: {} };
            upsertObj.$set[`settings.${chatIdStr}.alphabets.${langKey}.penalty`] = punish;
            if (punish === "mute" && !curMuteStr) {
                // set default string + numeric (ms)
                upsertObj.$set[`settings.${chatIdStr}.alphabets.${langKey}.mute_duration_str`] = "10 Minutes";
                upsertObj.$set[`settings.${chatIdStr}.alphabets.${langKey}.mute_duration`] = 10 * 60 * 1000; // ms
            }

            await user_setting_module.updateOne({ user_id: userIdKey }, upsertObj, { upsert: true });

            await ctx.answerCbQuery(`Punishment for ${LANGS[langKey].label} set to: ${punish}`);
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_SET_PUNISH error:", err);
        }
    });

    // Toggle Delete Message for language (uses dynamic label in UI)
    bot.action(/^ALPHABETS_TOGGLE_DELETE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            // fetch current value, then flip
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

    // Set mute duration (open prompt via session) — now shows rich prompt via safeEditOrSend
    bot.action(/^ALPHABETS_SET_MUTE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // set awaiting session
            ctx.session = ctx.session || {};
            ctx.session.awaitingAlphabetMute = { chatIdStr, userId, langKey, promptMessage: null };

            // prepare prompt text (formatted similar to the image)
            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.alphabets?.[langKey] || {};
            const current = entry?.mute_duration_str ?? (typeof entry?.mute_duration === "number" ? msToFallbackMinutes(entry.mute_duration) : "None");

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration of the chosen punishment (Mute)</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}`;

            // build inline keyboard like image (Remove duration and Cancel)
            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ALPHABETS_REMOVE_MUTE_${langKey}_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ALPHABETS_CANCEL_MUTE_${langKey}_${chatIdStr}`)]
            ];

            // send via safeEditOrSend so it either edits previous message or sends new
            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            // determine chatId/messageId for prompt so we can delete it later
            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingAlphabetMute) {
                ctx.session.awaitingAlphabetMute.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            // answer callback so UI responsiveness
            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("ALPHABETS_SET_MUTE action error:", err);
        }
    });

    // Remove duration handler
    bot.action(/^ALPHABETS_REMOVE_MUTE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            // Use $unset to remove fields
            await user_setting_module.updateOne({ user_id: userId }, {
                $unset: {
                    [`settings.${chatIdStr}.alphabets.${langKey}.mute_duration_str`]: "",
                    [`settings.${chatIdStr}.alphabets.${langKey}.mute_duration`]: ""
                }
            }, {});

            // if there was a prompt in session, delete it
            try {
                const session = ctx.session?.awaitingAlphabetMute;
                if (session && session.promptMessage) {
                    const { chatId, messageId } = session.promptMessage;
                    try { await bot.telegram.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
                    if (ctx.session) delete ctx.session.awaitingAlphabetMute;
                }
            } catch (_) { /* ignore */ }

            await ctx.answerCbQuery("Removed stored duration.");
            // re-render language menu
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_REMOVE_MUTE error:", err);
            try { await ctx.answerCbQuery("Failed to remove duration."); } catch (_) { }
        }
    });

    // Cancel handler - clears session and re-render language menu
    bot.action(/^ALPHABETS_CANCEL_MUTE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const langKey = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            // if prompt exists, delete it
            try {
                const session = ctx.session?.awaitingAlphabetMute;
                if (session && session.promptMessage) {
                    const { chatId, messageId } = session.promptMessage;
                    try { await bot.telegram.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
                }
            } catch (_) { /* ignore */ }

            if (ctx.session && ctx.session.awaitingAlphabetMute) delete ctx.session.awaitingAlphabetMute;
            await ctx.answerCbQuery("Cancelled.");
            // re-render language menu
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
        } catch (err) {
            console.error("ALPHABETS_CANCEL_MUTE error:", err);
            try { await ctx.answerCbQuery("Failed to cancel."); } catch (_) { }
        }
    });

    // Handle text input for awaitingAlphabetMute
    bot.on("text", async (ctx, next) => {
        try {
            if (!ctx.session || !ctx.session.awaitingAlphabetMute) {
                return next();
            }

            const { chatIdStr, userId, langKey } = ctx.session.awaitingAlphabetMute;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) {
                delete ctx.session.awaitingAlphabetMute;
                return;
            }

            const rawInput = (ctx.message.text || "").trim();
            if (!rawInput) {
                await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds`.");
                return;
            }

            const totalSeconds = parseDurationToSeconds(rawInput);
            if (totalSeconds === null) {
                await ctx.reply("❌ Couldn't parse duration. Use format like `3 month 2 days 12 hours 4 minutes 34 seconds` or just a number (minutes).");
                return;
            }

            const MIN_SECONDS = 30;
            const MAX_SECONDS = 365 * 24 * 3600;
            if (totalSeconds < MIN_SECONDS) {
                await ctx.reply("❌ Duration is too short. Minimum is 30 seconds.");
                return;
            }
            if (totalSeconds > MAX_SECONDS) {
                await ctx.reply("❌ Duration is too long. Maximum is 365 days.");
                return;
            }

            // Save raw input string and numeric milliseconds to DB
            const msValue = totalSeconds * 1000;
            try {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            // store raw string exactly as user typed
                            [`settings.${chatIdStr}.alphabets.${langKey}.mute_duration_str`]: rawInput,
                            // numeric in milliseconds
                            [`settings.${chatIdStr}.alphabets.${langKey}.mute_duration`]: msValue,
                            // ensure penalty remains mute
                            [`settings.${chatIdStr}.alphabets.${langKey}.penalty`]: "mute"
                        }
                    },
                    { upsert: true }
                );
            } catch (dbErr) {
                console.error("DB error saving mute_duration_str/ms:", dbErr);
                await ctx.reply("❌ Failed to save duration due to a server error.");
                delete ctx.session.awaitingAlphabetMute;
                return;
            }

            // delete the prompt message shown to the user (if available)
            try {
                const session = ctx.session.awaitingAlphabetMute;
                const msg = session && session.promptMessage ? session.promptMessage : null;
                if (msg && msg.chatId && msg.messageId) {
                    try { await bot.telegram.deleteMessage(msg.chatId, msg.messageId); } catch (_) { /* ignore */ }
                } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                    try { await bot.telegram.deleteMessage(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id); } catch (_) { /* ignore */ }
                }
            } catch (_) { /* ignore */ }

            // clear session
            if (ctx.session && ctx.session.awaitingAlphabetMute) delete ctx.session.awaitingAlphabetMute;

            // re-render language menu for fresh UI
            await renderAlphabetLangMenu(ctx, chatIdStr, userId, langKey);
            return;
        } catch (err) {
            console.error("ALPHABETS awaiting mute text error:", err);
            if (ctx.session?.awaitingAlphabetMute) delete ctx.session.awaitingAlphabetMute;
        } finally {
            return next();
        }
    });

    // (Other handlers remain as before — back buttons etc.)
};
