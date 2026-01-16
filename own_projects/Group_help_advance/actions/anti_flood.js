const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const parseDurationToSeconds = require('../helpers/parseDurationToSeconds')
const first_letter_uppercase = require("../helpers/first_letter_uppercase");

// Antiflood menu with unified duration and Set duration button
async function renderAntifloodMenu(ctx, chatIdStr, userId) {
    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;

    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const af = userDoc?.settings?.[chatIdStr]?.anti_flood || {};

    const msgLimit = typeof af.message_limit === "number" ? af.message_limit : 5;
    const timeFrame = typeof af.time_frame === "number" ? af.time_frame : 3;
    const punishment = (af.penalty || "off").toLowerCase(); // off|warn|kick|mute|ban
    const deleteMessages = !!af.delete_messages;

    // unified duration: prefer antiflood.penalty_duration_str
    let penaltyDurationStr = af.penalty_duration_str || "None";

    // Display string per punishment
    let punishmentDisplay = "";
    if (punishment === "off") punishmentDisplay = "Off";
    else if (punishment === "warn") punishmentDisplay = `Warn${penaltyDurationStr !== "None" ? ` (${penaltyDurationStr})` : ""}`;
    else if (punishment === "kick") punishmentDisplay = "Kick";
    else if (punishment === "ban") punishmentDisplay = `Ban${penaltyDurationStr !== "None" ? ` (${penaltyDurationStr})` : ""}`;
    else if (punishment === "mute") punishmentDisplay = `Mute ${penaltyDurationStr !== "None" ? penaltyDurationStr : "10 Minutes"}`;
    else punishmentDisplay = punishment;

    const ok = "✅";
    const no = "❌";

    let text =
        `🌊 <b>Antiflood</b>\n\n` +
        `From this menu a penalty can be set for those who send many messages in a short time.\n\n` +
        `Currently antiflood triggers when <b>${msgLimit}</b> messages are sent within <b>${timeFrame}</b> seconds.\n\n` +
        `<b>Penalty</b>: ${first_letter_uppercase(punishment)}\n` +
        `<b>Delete messages</b>: ${deleteMessages ? `On ${ok}` : `Off ${no}`}\n\n`;

    // Show penalty duration and permanence note only when relevant
    if (["warn", "mute", "ban"].includes(punishment)) {
        text += `<b>Penalty duration:</b> ${penaltyDurationStr}\n\n`;
        text += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n\n`;
    }

    text += `<i>👉 Use the buttons below to control this setting for <b>${(isOwner) ? isOwner?.title : chatIdStr}</b>.</i>`;

    const rows = [];
    rows.push([
        Markup.button.callback("📄 Messages", `ANTIFLOOD_MESSAGES_${chatIdStr}`),
        Markup.button.callback("⏱️ Time", `ANTIFLOOD_TIME_${chatIdStr}`)
    ]);
    rows.push([
        Markup.button.callback("❌ Off", `ANTIFLOOD_PUNISH_off_${chatIdStr}`),
        Markup.button.callback("❗ Warn", `ANTIFLOOD_PUNISH_warn_${chatIdStr}`)
    ]);
    rows.push([
        Markup.button.callback("❗ Kick", `ANTIFLOOD_PUNISH_kick_${chatIdStr}`),
        Markup.button.callback("🔕 Mute", `ANTIFLOOD_PUNISH_mute_${chatIdStr}`),
        Markup.button.callback("⛔ Ban", `ANTIFLOOD_PUNISH_ban_${chatIdStr}`)
    ]);
    rows.push([
        Markup.button.callback(deleteMessages ? "🗑️ Delete Messages ✓" : "🗑️ Delete Messages ✗", `ANTIFLOOD_TOGGLE_DELETE_${chatIdStr}`)
    ]);

    // Set duration button only for warn/mute/ban
    if (["warn", "mute", "ban"].includes(punishment)) {
        rows.push([
            Markup.button.callback(
                `⏲️ Set ${first_letter_uppercase(punishment)} Duration (${penaltyDurationStr})`,
                `ANTIFLOOD_SET_DURATION_${chatIdStr}_${punishment}`
            )
        ]);
    }

    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    const keyboard = { inline_keyboard: rows };

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

    // PUNISHMENT SETTING
    bot.action(/^ANTIFLOOD_PUNISH_(off|warn|kick|mute|ban)_(.+)$/i, async (ctx) => {
        try {
            const action = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            // If switching to a duration-based penalty and duration missing -> set defaults
            if (["warn", "mute", "ban"].includes(action)) {
                const doc = await user_setting_module.findOne({ user_id: userId }).lean();
                const hasDuration = !!doc?.settings?.[chatIdStr]?.anti_flood?.penalty_duration_str;
                if (!hasDuration) {
                    await user_setting_module.findOneAndUpdate(
                        { user_id: userId },
                        {
                            $set: {
                                [`settings.${chatIdStr}.anti_flood.penalty_duration_str`]: "10 minutes",
                                [`settings.${chatIdStr}.anti_flood.penalty_duration`]: 600000
                            }
                        },
                        { upsert: true, setDefaultsOnInsert: true }
                    );
                }
            }

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.anti_flood.penalty`]: action } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`✅ Antiflood penalty set to ${action.charAt(0).toUpperCase() + action.slice(1)}`);
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("Error in ANTIFLOOD_PUNISH_*:", err);
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

    // Open Set Duration prompt for the current penalty (warn/mute/ban)
    bot.action(/^ANTIFLOOD_SET_DURATION_(.+)_(warn|mute|ban)$/i, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const penaltyKind = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingAntifloodDuration = { chatIdStr, penaltyKind, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const af = userDoc?.settings?.[chatIdStr]?.anti_flood || {};
            const current = af.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for ${penaltyKind.toUpperCase()} penalty (Antiflood)</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ANTIFLOOD_REMOVE_DURATION_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ANTIFLOOD_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            // store prompt message location
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
            if (promptChatId && promptMsgId) {
                ctx.session.awaitingAntifloodDuration.promptMessage = { chatId: promptChatId, messageId: promptMsgId };
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("ANTIFLOOD_SET_DURATION action error:", err);
        }
    });

    // Remove duration -> set to None (permanent)
    bot.action(/^ANTIFLOOD_REMOVE_DURATION_(.+)$/i, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.anti_flood.penalty_duration`]: "",
                        [`settings.${chatIdStr}.anti_flood.penalty_duration_str`]: ""
                    }
                }
            );

            await ctx.answerCbQuery("🗑️ Duration removed (penalty becomes permanent)"); // permanence note [attached_file:177]
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_REMOVE_DURATION error:", err);
        }
    });

    // Cancel setting duration
    bot.action(/^ANTIFLOOD_CANCEL_SET_(.+)$/i, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            if (ctx.session && ctx.session.awaitingAntifloodDuration) {
                ctx.session.awaitingAntifloodDuration = null;
            }
            await ctx.answerCbQuery("❌ Cancelled");
            await renderAntifloodMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ANTIFLOOD_CANCEL_SET error:", err);
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
            if (ctx.session?.awaitingAntifloodDuration) {
                const { chatIdStr, userId, penaltyKind, promptMessage } = ctx.session.awaitingAntifloodDuration;

                // Permission check
                const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
                if (!chat) {
                    delete ctx.session.awaitingAntifloodDuration;
                    return;
                }

                // Input
                const rawInput = (ctx.message?.text || "").trim();
                if (!rawInput) {
                    await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                    return;
                }

                // Parse and validate
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

                // Save unified fields on anti_flood
                const msValue = totalSeconds * 1000;
                try {
                    await user_setting_module.updateOne(
                        { user_id: userId },
                        {
                            $setOnInsert: { user_id: userId },
                            $set: {
                                [`settings.${chatIdStr}.anti_flood.penalty_duration_str`]: rawInput,
                                [`settings.${chatIdStr}.anti_flood.penalty_duration`]: msValue,
                                // keep the chosen penalty (do not force mute; keep existing or caller will set)
                                // Optionally enforce the current kind:
                                // [`settings.${chatIdStr}.anti_flood.penalty`]: penaltyKind
                            }
                        },
                        { upsert: true }
                    );
                } catch (dbErr) {
                    console.error("DB error saving antiflood duration:", dbErr);
                    await ctx.reply("❌ Failed to save duration due to a server error.");
                    delete ctx.session.awaitingAntifloodDuration;
                    return;
                }

                // Clean up prompt if we stored it
                try {
                    if (promptMessage?.chatId && promptMessage?.messageId) {
                        try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                    } else if (ctx.callbackQuery?.message) {
                        try { await bot.telegram.deleteMessage(ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id); } catch (_) { }
                    }
                } catch (_) { }

                // Clear session and refresh menu
                delete ctx.session.awaitingAntifloodDuration;
                await ctx.reply(`✅ ${first_letter_uppercase(penaltyKind)} duration saved: ${rawInput}.`);
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
