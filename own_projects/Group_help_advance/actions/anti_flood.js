const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const parseDurationToSeconds = require('../helpers/parseDurationToSeconds')

// helper: pretty-print milliseconds fallback (simple minutes/hours/days/months)
function msToFallback(ms) {
    if (typeof ms !== "number" || Number.isNaN(ms)) return null;
    let seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} days`;
    const months = Math.floor(days / 30);
    return `${months} months`;
}

// Backwards/compatibility helper: if value is small (<= 1000000) assume minutes; else ms.
function numericToDisplay(num) {
    if (typeof num !== "number" || Number.isNaN(num)) return null;
    // if it's clearly milliseconds (> 1000*60 = 60000) but could be minutes too
    // Heuristic: if > 100000 (100 seconds) treat as ms if very large. But safer:
    // If >= 1000 -> likely ms; If <= 10000 -> likely minutes. We'll adopt:
    if (num >= 1000) {
        // assume milliseconds
        return msToFallback(num);
    } else {
        // assume minutes
        return `${num} minutes`;
    }
}

// render antiflood menu
async function renderAntifloodMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const af = userDoc?.settings?.[chatIdStr]?.anti_flood || {};

    // defaults
    const msgLimit = typeof af.message_limit === "number" ? af.message_limit : 5;
    const timeFrame = typeof af.time_frame === "number" ? af.time_frame : 3;
    const punishment = af.penalty || "off"; // off|warn|kick|mute|ban
    const deleteMessages = !!af.delete_messages;

    // Determine display for mute duration: prefer raw string; else numericToDisplay
    let muteDurationDisplay = null;
    if (af?.mute_duration_str) {
        muteDurationDisplay = af.mute_duration_str;
    } else if (typeof af.mute_duration === "number") {
        muteDurationDisplay = numericToDisplay(af.mute_duration);
    } else {
        muteDurationDisplay = null;
    }

    const ok = "✅";
    const no = "❌";

    // build punishment display string
    let punishmentDisplay = "";
    if (punishment === "off") punishmentDisplay = "Off";
    else if (punishment === "warn") punishmentDisplay = "Warn";
    else if (punishment === "kick") punishmentDisplay = "Kick";
    else if (punishment === "ban") punishmentDisplay = "Ban";
    else if (punishment === "mute") punishmentDisplay = `Mute ${muteDurationDisplay ?? "10 Minutes"}`;
    else punishmentDisplay = punishment;

    const text =
        `🌊 <b>Antiflood</b>\n\n` +
        `From this menu you can set a punishment for those who send many messages in a short time.\n\n` +
        `Currently the antiflood is triggered when <b>${msgLimit}</b> messages are sent within <b>${timeFrame}</b> seconds.\n\n` +
        `Punishment: <b>${punishmentDisplay}</b>\n` +
        `Delete messages: ${deleteMessages ? `On ${ok}` : `Off ${no}`}`;

    // keyboard rows
    const keyboardRows = [];

    // Messages / Time row
    keyboardRows.push([
        Markup.button.callback("📄 Messages", `ANTIFLOOD_MESSAGES_${chatIdStr}`),
        Markup.button.callback("⏱️ Time", `ANTIFLOOD_TIME_${chatIdStr}`)
    ]);

    // punishments - show buttons
    keyboardRows.push([
        Markup.button.callback("❌ Off", `ANTIFLOOD_PUNISH_off_${chatIdStr}`),
        Markup.button.callback("❗ Warn", `ANTIFLOOD_PUNISH_warn_${chatIdStr}`)
    ]);

    keyboardRows.push([
        Markup.button.callback("❗ Kick", `ANTIFLOOD_PUNISH_kick_${chatIdStr}`),
        Markup.button.callback("🔕 Mute", `ANTIFLOOD_PUNISH_mute_${chatIdStr}`),
        Markup.button.callback("⛔ Ban", `ANTIFLOOD_PUNISH_ban_${chatIdStr}`)
    ]);

    // delete messages toggle
    keyboardRows.push([
        Markup.button.callback(deleteMessages ? "🗑️ Delete Messages ✅" : "🗑️ Delete Messages ❌", `ANTIFLOOD_TOGGLE_DELETE_${chatIdStr}`)
    ]);

    // If punishment is mute, show Set mute duration button
    if (punishment === "mute") {
        keyboardRows.push([
            Markup.button.callback("⏲️ Set mute duration", `ANTIFLOOD_SET_MUTE_DURATION_${chatIdStr}`)
        ]);
    }

    // Back
    keyboardRows.push([
        Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)
    ]);

    const keyboard = { inline_keyboard: keyboardRows };

    // use safeEditOrSend to show menu
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
}

// antiflood module
module.exports = (bot) => {
    // OPEN MENU
    bot.action(/^SET_ANTIFLOOD_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ANTIFLOOD error:", err);
        }
    });

    // Show numeric grid (1..20) using current DB values for message_limit and time_frame
    bot.action(/^ANTIFLOOD_MESSAGES_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // read current antiflood settings to show dynamic values
            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const af = userDoc?.settings?.[chatIdStr]?.anti_flood || {};
            const currentMsgs = typeof af.message_limit === "number" ? af.message_limit : 5;
            const currentSecs = typeof af.time_frame === "number" ? af.time_frame : 3;

            const text =
                `From here you can select the maximum amount of sendable messages in the time interval.\n` +
                `Currently, the antiflood triggers when <b>${currentMsgs}</b> messages are sent in <b>${currentSecs}</b> seconds.\n\n` +
                `Choose a number (1–20):`;

            // build 1..20 buttons, 4 per row
            const keyboardRows = [];
            let row = [];
            for (let i = 1; i <= 20; i++) {
                row.push(Markup.button.callback(String(i), `ANTIFLOOD_SET_MESSAGES_${i}_${chatIdStr}`));
                if (row.length === 4) {
                    keyboardRows.push(row);
                    row = [];
                }
            }
            if (row.length) keyboardRows.push(row);

            // back button row
            keyboardRows.push([
                Markup.button.callback("⬅️ Back", `SET_ANTIFLOOD_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, text, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: keyboardRows }
            });
        } catch (err) {
            console.error("ANTIFLOOD_MESSAGES handler error:", err);
        }
    });

    // Handler for when user presses a number button
    bot.action(/^ANTIFLOOD_SET_MESSAGES_(\d+)_(-?\d+)$/, async (ctx) => {
        try {
            const num = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // persist to DB
            const userIdKey = userId; // change to String(userId) if your schema stores user_id as string
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.anti_flood.message_limit`]: num }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`✅ Antiflood messages threshold set to ${num}.`);
            // re-render main antiflood menu so user sees updated summary
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_SET_MESSAGES error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (e) {/*ignore*/ }
        }
    });

    // SHOW seconds grid (1..20)
    bot.action(/^ANTIFLOOD_TIME_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // read current antiflood values to display
            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const af = userDoc?.settings?.[chatIdStr]?.anti_flood || {};
            const currentMsgs = typeof af.message_limit === "number" ? af.message_limit : 5;
            const currentSecs = typeof af.time_frame === "number" ? af.time_frame : 3;

            const text =
                `From here you can select the time interval considered to calculate the antiflood.\n` +
                `Currently, the antiflood triggers when <b>${currentMsgs}</b> messages are sent in <b>${currentSecs}</b> seconds.\n\n` +
                `Choose seconds (1–20):`;

            // build 1..20 buttons, 4 per row
            const keyboardRows = [];
            let row = [];
            for (let i = 1; i <= 20; i++) {
                row.push(Markup.button.callback(String(i), `ANTIFLOOD_SET_TIME_${i}_${chatIdStr}`));
                if (row.length === 4) {
                    keyboardRows.push(row);
                    row = [];
                }
            }
            if (row.length) keyboardRows.push(row);

            // back
            keyboardRows.push([
                Markup.button.callback("⬅️ Back", `SET_ANTIFLOOD_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, text, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: keyboardRows }
            });
        } catch (err) {
            console.error("ANTIFLOOD_TIME handler error:", err);
        }
    });

    // SAVE chosen seconds and re-render menu
    bot.action(/^ANTIFLOOD_SET_TIME_(\d+)_(-?\d+)$/, async (ctx) => {
        try {
            const secs = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId; // use String(userId) if your schema stores user_id as string
            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.anti_flood.time_frame`]: secs }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`✅ Antiflood timeframe set to ${secs} seconds.`);
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_SET_TIME error:", err);
            try { await ctx.answerCbQuery("⚠️ Error while saving."); } catch (e) { /* ignore */ }
        }
    });

    // SET MUTE DURATION (session) - now rich prompt + parsing like alphabets module
    bot.action(/^ANTIFLOOD_SET_MUTE_DURATION_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingAntifloodMuteDuration = { chatIdStr, userId, promptMessage: null };

            // read current values for display
            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_flood || {};
            const current = entry?.mute_duration_str ?? (typeof entry?.mute_duration === "number" ? numericToDisplay(entry.mute_duration) : "None");

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration of the chosen punishment (Mute)</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n` 

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ANTIFLOOD_REMOVE_MUTE_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ANTIFLOOD_CANCEL_MUTE_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            // try to capture chat/message id for later deletion
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

            if (ctx.session && ctx.session.awaitingAntifloodMuteDuration) {
                ctx.session.awaitingAntifloodMuteDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("ANTIFLOOD_SET_MUTE_DURATION action error:", err);
        }
    });

    // REMOVE mute duration handler
    bot.action(/^ANTIFLOOD_REMOVE_MUTE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne({ user_id: userId }, {
                $unset: {
                    [`settings.${chatIdStr}.anti_flood.mute_duration_str`]: "",
                    [`settings.${chatIdStr}.anti_flood.mute_duration`]: ""
                }
            }, {});

            // attempt to delete prompt message if present in session
            try {
                const session = ctx.session?.awaitingAntifloodMuteDuration;
                if (session && session.promptMessage) {
                    const { chatId, messageId } = session.promptMessage;
                    try { await bot.telegram.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
                    if (ctx.session) delete ctx.session.awaitingAntifloodMuteDuration;
                }
            } catch (_) { /* ignore */ }

            await ctx.answerCbQuery("Removed stored duration.");
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_REMOVE_MUTE error:", err);
            try { await ctx.answerCbQuery("Failed to remove duration."); } catch (_) { /* ignore */ }
        }
    });

    // CANCEL mute-duration prompt
    bot.action(/^ANTIFLOOD_CANCEL_MUTE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // delete prompt if present
            try {
                const session = ctx.session?.awaitingAntifloodMuteDuration;
                if (session && session.promptMessage) {
                    const { chatId, messageId } = session.promptMessage;
                    try { await bot.telegram.deleteMessage(chatId, messageId); } catch (_) { /* ignore */ }
                }
            } catch (_) { /* ignore */ }

            if (ctx.session && ctx.session.awaitingAntifloodMuteDuration) delete ctx.session.awaitingAntifloodMuteDuration;
            await ctx.answerCbQuery("Cancelled.");
            await safeEditOrSend(ctx, "❌ Cancelled. No changes were made.", {});
        } catch (err) {
            console.error("ANTIFLOOD_CANCEL_MUTE error:", err);
            try { await ctx.answerCbQuery("Failed to cancel."); } catch (_) { /* ignore */ }
        }
    });

    // PUNISHMENT SETTING
    bot.action(/^ANTIFLOOD_PUNISH_(off|warn|kick|mute|ban)_(-?\d+)$/, async (ctx) => {
        try {
            const punish = ctx.match[1]; // off|warn|kick|mute|ban
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId; // cast to String(userId) if you store user_id as string

            // If switching to mute and there is no mute_duration set, ensure default (10 minutes) both fields
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const curMuteStr = userDoc?.settings?.[chatIdStr]?.anti_flood?.mute_duration_str;
            const curMuteNum = userDoc?.settings?.[chatIdStr]?.anti_flood?.mute_duration;

            const upsertObj = {
                $setOnInsert: { user_id: userIdKey },
                $set: {
                    [`settings.${chatIdStr}.anti_flood.penalty`]: punish
                }
            };

            if (punish === "mute" && !curMuteStr && typeof curMuteNum !== "number") {
                upsertObj.$set[`settings.${chatIdStr}.anti_flood.mute_duration_str`] = "10 Minutes";
                upsertObj.$set[`settings.${chatIdStr}.anti_flood.mute_duration`] = 10 * 60 * 1000; // store ms
            }

            await user_setting_module.updateOne({ user_id: userIdKey }, upsertObj, { upsert: true });

            await ctx.answerCbQuery(`Punishment set to: ${punish}`);
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_PUNISH error:", err);
        }
    });

    // TOGGLE delete messages
    bot.action(/^ANTIFLOOD_TOGGLE_DELETE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.anti_flood?.delete_messages;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.anti_flood.delete_messages`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete messages: ${newVal ? "On ✅" : "Off ❌"}`);
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_TOGGLE_DELETE error:", err);
        }
    });

    // TEXT handler for awaiting inputs (messages, seconds, mute duration)
    bot.on("text", async (ctx, next) => {
        try {
            ctx.session = ctx.session || {};

            // MESSAGES threshold (legacy session flow, if you still use)
            if (ctx.session.awaitingAntifloodMessages) {
                const { chatIdStr, userId } = ctx.session.awaitingAntifloodMessages;
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingAntifloodMessages;
                    return;
                }

                const num = parseInt((ctx.message.text || "").trim(), 10);
                if (Number.isNaN(num) || num <= 0) {
                    await ctx.reply("❌ Invalid number. Send a positive integer (e.g. 5).");
                    return;
                }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: { [`settings.${chatIdStr}.anti_flood.message_limit`]: num }
                    },
                    { upsert: true }
                );

                await ctx.reply(`✅ Antiflood messages threshold set to ${num}.`);
                delete ctx.session.awaitingAntifloodMessages;
                await renderAntifloodMenu(ctx, chatIdStr, userId);
                return;
            }

            // TIMEFRAME seconds (legacy)
            if (ctx.session.awaitingAntifloodSeconds) {
                const { chatIdStr, userId } = ctx.session.awaitingAntifloodSeconds;
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingAntifloodSeconds;
                    return;
                }

                const num = parseInt((ctx.message.text || "").trim(), 10);
                if (Number.isNaN(num) || num <= 0) {
                    await ctx.reply("❌ Invalid number. Send a positive integer of seconds (e.g. 3).");
                    return;
                }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: { [`settings.${chatIdStr}.anti_flood.time_frame`]: num }
                    },
                    { upsert: true }
                );

                await ctx.reply(`✅ Antiflood timeframe set to ${num} seconds.`);
                delete ctx.session.awaitingAntifloodSeconds;
                await renderAntifloodMenu(ctx, chatIdStr, userId);
                return;
            }

            // MUTE DURATION (rich flow)
            if (ctx.session.awaitingAntifloodMuteDuration) {
                const { chatIdStr, userId } = ctx.session.awaitingAntifloodMuteDuration;
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingAntifloodMuteDuration;
                    return;
                }

                const rawInput = (ctx.message.text || "").trim();
                if (!rawInput) {
                    await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                    return;
                }

                const totalSeconds = parseDurationToSeconds(rawInput);
                if (totalSeconds === null) {
                    await ctx.reply("❌ Couldn't parse duration. Use format like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
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
                                [`settings.${chatIdStr}.anti_flood.mute_duration_str`]: rawInput,
                                [`settings.${chatIdStr}.anti_flood.mute_duration`]: msValue,
                                [`settings.${chatIdStr}.anti_flood.penalty`]: "mute"
                            }
                        },
                        { upsert: true }
                    );
                } catch (dbErr) {
                    console.error("DB error saving antiflood mute duration:", dbErr);
                    await ctx.reply("❌ Failed to save duration due to a server error.");
                    delete ctx.session.awaitingAntifloodMuteDuration;
                    return;
                }

                // delete the prompt message shown to the user (if available)
                try {
                    const session = ctx.session.awaitingAntifloodMuteDuration;
                    const msg = session && session.promptMessage ? session.promptMessage : null;
                    if (msg && msg.chatId && msg.messageId) {
                        try { await bot.telegram.deleteMessage(msg.chatId, msg.messageId); } catch (_) { /* ignore */ }
                    } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                        try { await bot.telegram.deleteMessage(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id); } catch (_) { /* ignore */ }
                    }
                } catch (_) { /* ignore */ }

                // clear session
                if (ctx.session && ctx.session.awaitingAntifloodMuteDuration) delete ctx.session.awaitingAntifloodMuteDuration;

                // re-render menu
                await renderAntifloodMenu(ctx, chatIdStr, userId);
                return;
            }
        } catch (err) {
            console.error("ANTIFLOOD incoming text handler error:", err);
            // clear possible sessions to avoid stuck states
            if (ctx.session?.awaitingAntifloodMessages) delete ctx.session.awaitingAntifloodMessages;
            if (ctx.session?.awaitingAntifloodSeconds) delete ctx.session.awaitingAntifloodSeconds;
            if (ctx.session?.awaitingAntifloodMuteDuration) delete ctx.session.awaitingAntifloodMuteDuration;
        }

        if (typeof next === "function") {
            await next();
        }
    });
};
