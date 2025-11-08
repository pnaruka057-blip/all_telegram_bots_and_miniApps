const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// Icons and constants
const ICON = {
    warn: "❕",
    kick: "❗",
    mute: "🔇",
    ban: "🚫"
};

const WITH_DURATION = new Set(["warn", "mute", "ban"]);
const MIN_MS = 30 * 1000;
const MAX_MS = 365 * 24 * 3600 * 1000;

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function prettyMs(ms) {
    if (!ms || ms <= 0) return "None";
    const sec = Math.floor(ms / 1000);
    const units = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
        ["second", 1]
    ];
    let rem = sec;
    const parts = [];
    for (const [name, size] of units) {
        if (rem >= size) {
            const n = Math.floor(rem / size);
            rem %= size;
            parts.push(`${n} ${name}${n > 1 ? "s" : ""}`);
            if (parts.length === 3) break;
        }
    }
    return parts.join(" ");
}

function parseHumanToMs(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim().toLowerCase();
    if (/^\d+$/.test(s)) {
        const ms = parseInt(s, 10) * 1000;
        return { ms, norm: `${s} seconds` };
    }
    const map = {
        s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
        m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
        h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000,
        d: 86400000, day: 86400000, days: 86400000,
        w: 604800000, wk: 604800000, wks: 604800000, week: 604800000, weeks: 604800000,
        mon: 2592000000, month: 2592000000, months: 2592000000,
        y: 31536000000, yr: 31536000000, yrs: 31536000000, year: 31536000000, years: 31536000000
    };
    let total = 0;
    const picked = [];
    const re = /(\d+)\s*([a-z]+)/g;
    let m;
    while ((m = re.exec(s))) {
        const val = parseInt(m[1], 10);
        const unit = m[2];
        const mult = map[unit];
        if (!mult) return null;
        total += val * mult;
        picked.push(`${val} ${unit}`);
    }
    if (total <= 0) return null;
    return { ms: total, norm: picked.join(" ") };
}

function getPORN(userDoc, chatIdStr) {
    return userDoc?.settings?.[chatIdStr]?.porn || {};
}

// UI
async function renderPornMenu(ctx, chatIdStr, userId, isOwner) {
    ctx.session = {}
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const porn = getPORN(userDoc, chatIdStr);
    const enabled = !!porn.enabled;
    const penalty = (porn.penalty || "off").toLowerCase();
    const durStr = porn.penalty_duration_str || "None";
    const del = porn.delete_messages ? "On ✅" : "Off ❌";

    const text =
        `<b>🔞 Porn Filter</b>\n\n` +
        `This setting helps you automatically manage pornographic content sent by any group member.\n\n` +
        `<b>How it works:</b>\n` +
        `• When this filter is <b>On</b>, the bot scans every message for porn-related content.\n` +
        `• If a violation is detected, the bot applies the <b>Penalty</b> you have chosen (e.g., Mute, Kick, or Ban).\n` +
        `• If <b>Delete Messages</b> is on, the violating message will also be deleted.\n\n` +
        `<b>Current Settings:</b>\n` +
        `<b>Status:</b> ${enabled ? "On ✅" : "Off ❌"}\n` +
        `<b>Penalty:</b> ${penalty.toUpperCase()}\n` +
        (WITH_DURATION.has(penalty) ? `<b>Penalty duration:</b> ${esc(durStr)}\n` : ``) +
        `<b>Delete Messages:</b> ${del}\n\n` +
        `<i>👉 Use the buttons below to control this setting for <b>${isOwner?.title}</b>.</i>`;

    const rows = [];

    // On/Off buttons (PORT_TURN_ON/OFF)
    rows.push([
        Markup.button.callback("✅ Turn on", `PORT_TURN_ON_${chatIdStr}`),
        Markup.button.callback("❌ Turn off", `PORT_TURN_OFF_${chatIdStr}`)
    ]);

    // Penalty rows
    rows.push([
        Markup.button.callback("❌ Off", `PORN_SET_penalty_off_${chatIdStr}`),
        Markup.button.callback(`${ICON.warn} Warn`, `PORN_SET_penalty_warn_${chatIdStr}`),
        Markup.button.callback(`${ICON.kick} Kick`, `PORN_SET_penalty_kick_${chatIdStr}`)
    ]);
    rows.push([
        Markup.button.callback(`${ICON.mute} Mute`, `PORN_SET_penalty_mute_${chatIdStr}`),
        Markup.button.callback(`${ICON.ban} Ban`, `PORN_SET_penalty_ban_${chatIdStr}`)
    ]);

    // Delete toggle
    rows.push([
        Markup.button.callback(`🗑 Delete Messages ${porn.delete_messages ? "✅" : "❌"}`, `PORN_TOGGLE_delete_${chatIdStr}`)
    ]);

    // Duration controls
    if (WITH_DURATION.has(penalty)) {
        const label =
            penalty === "warn" ? `⏲️ Set Warn Duration (${durStr})` :
                penalty === "mute" ? `⏲️ Set Mute Duration (${durStr})` :
                    `⏲️ Set Ban Duration (${durStr})`;
        rows.push([Markup.button.callback(label, `PORN_DUR_OPEN_${chatIdStr}`)]);
    }

    rows.push([
        Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)
    ]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Mutations
async function setEnabled(userId, chatIdStr, on) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.porn.enabled`]: !!on } },
        { upsert: true }
    );
}

async function setPenalty(userId, chatIdStr, pen) {
    const path = `settings.${chatIdStr}.porn`;
    const doc = await user_setting_module.findOne(
        { user_id: userId },
        { projection: { [`${path}.penalty_duration`]: 1, [`${path}.penalty_duration_str`]: 1 } }
    ).lean();

    const hasDur = !!(doc?.settings?.[chatIdStr]?.porn?.penalty_duration || 0);
    const hasDurStr = !!(doc?.settings?.[chatIdStr]?.porn?.penalty_duration_str || "");

    const $set = { [`${path}.penalty`]: pen };
    if (!hasDur) $set[`${path}.penalty_duration`] = 10 * 60 * 1000;
    if (!hasDurStr) $set[`${path}.penalty_duration_str`] = "10 minutes";

    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set },
        { upsert: true }
    );
}

async function toggleDelete(userId, chatIdStr) {
    const ns = `settings.${chatIdStr}.porn`;
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const cur = !!(doc?.settings?.[chatIdStr]?.porn?.delete_messages);
    const newVal = !cur;
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set: { [`${ns}.delete_messages`]: newVal } },
        { upsert: true }
    );
    return newVal;
}

async function openDurationPrompt(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const porn = getPORN(doc, chatIdStr);
    const penalty = (porn.penalty || "off").toLowerCase();
    if (!WITH_DURATION.has(penalty)) {
        await ctx.answerCbQuery("Duration is available only for Warn/Mute/Ban.", { show_alert: true });
        return;
    }
    const current = porn.penalty_duration_str || "None";
    const example = "3 month 2 days 12 hours 4 minutes 34 seconds";

    const text =
        `⏲️ <b>Send now the duration for ${penalty.toUpperCase()} penalty</b>\n\n` +
        `<b>Minimum:</b> ${prettyMs(MIN_MS)}\n` +
        `<b>Maximum:</b> ${prettyMs(MAX_MS)}\n\n` +
        `<b>Example of format:</b> <code>${example}</code>\n\n` +
        `<b>Current duration:</b> ${esc(current)}\n\n`;

    const buttons = [
        [Markup.button.callback("🗑️ Remove duration", `PORN_DUR_REMOVE_${chatIdStr}`)],
        [Markup.button.callback("❌ Cancel", `PORN_DUR_CANCEL_${chatIdStr}`)]
    ];

    const sent = await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
    });

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

    ctx.session = ctx.session || {};
    ctx.session.pornDurAwait = {
        chatIdStr, userId,
        promptMessage: promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null
    };

    try { await ctx.answerCbQuery(); } catch (_) { }
}

async function removeDuration(userId, chatIdStr) {
    await user_setting_module.updateOne(
        { user_id: userId },
        {
            $setOnInsert: { user_id: userId },
            $set: {
                [`settings.${chatIdStr}.porn.penalty_duration`]: 0,
                [`settings.${chatIdStr}.porn.penalty_duration_str`]: "None"
            }
        },
        { upsert: true }
    );
}

async function saveDuration(userId, chatIdStr, ms, norm) {
    await user_setting_module.updateOne(
        { user_id: userId },
        {
            $setOnInsert: { user_id: userId },
            $set: {
                [`settings.${chatIdStr}.porn.penalty_duration`]: ms,
                [`settings.${chatIdStr}.porn.penalty_duration_str`]: norm
            }
        },
        { upsert: true }
    );
}

// Export
module.exports = (bot) => {
    // Open menu
    bot.action(/^SET_PORN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("SET_PORN error:", e); }
    });

    // Turn on/off
    bot.action(/^PORT_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await setEnabled(userId, chatIdStr, true);
            await ctx.answerCbQuery("Porn Filter: On");
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("PORT_TURN_ON error:", e); }
    });

    bot.action(/^PORT_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await setEnabled(userId, chatIdStr, false);
            await ctx.answerCbQuery("Porn Filter: Off");
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("PORT_TURN_OFF error:", e); }
    });

    // Penalty
    bot.action(/^PORN_SET_penalty_(off|warn|kick|mute|ban)_(-?\d+)$/, async (ctx) => {
        try {
            const pen = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await setPenalty(userId, chatIdStr, pen);
            await ctx.answerCbQuery(`Penalty set: ${pen.toUpperCase()}`);
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("PORN_SET_penalty error:", e); }
    });

    // Delete toggle
    bot.action(/^PORN_TOGGLE_delete_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            const v = await toggleDelete(userId, chatIdStr);
            await ctx.answerCbQuery(`Delete: ${v ? "On" : "Off"}`);
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("PORN_TOGGLE_delete error:", e); }
    });

    // Duration open/remove/cancel
    bot.action(/^PORN_DUR_OPEN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await openDurationPrompt(ctx, chatIdStr, userId);
        } catch (e) { console.error("PORN_DUR_OPEN error:", e); }
    });

    bot.action(/^PORN_DUR_REMOVE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await removeDuration(userId, chatIdStr);
            if (ctx.session?.pornDurAwait?.promptMessage) {
                const { chatId: pChatId, messageId: pMsgId } = ctx.session.pornDurAwait.promptMessage;
                try { await ctx.telegram.deleteMessage(pChatId, pMsgId); } catch (_) { }
            }
            if (ctx.session?.pornDurAwait) delete ctx.session.pornDurAwait;
            await ctx.answerCbQuery("Duration removed");
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("PORN_DUR_REMOVE error:", e); }
    });

    bot.action(/^PORN_DUR_CANCEL_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            if (ctx.session?.pornDurAwait) delete ctx.session.pornDurAwait;
            await ctx.answerCbQuery("Cancelled");
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("PORN_DUR_CANCEL error:", e); }
    });

    // Duration text capture
    bot.on("text", async (ctx, next) => {
        try {
            const awaitObj = ctx.session?.pornDurAwait;
            if (!awaitObj) return next();

            const { chatIdStr, userId, promptMessage } = awaitObj;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const raw = (ctx.message.text || "").trim();
            const parsed = parseHumanToMs(raw);
            if (!parsed) {
                const txt =
                    `❌ Invalid duration.\n\n` +
                    `<b>Minimum:</b> ${prettyMs(MIN_MS)}\n` +
                    `<b>Maximum:</b> ${prettyMs(MAX_MS)}\n\n` +
                    `Examples:\n- 30s\n- 10m\n- 2 hours\n- 3 days 4 hours\n\n` +
                    `Try again or Cancel.`;
                await safeEditOrSend(ctx, txt, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PORN_DUR_CANCEL_${chatIdStr}`)]] }
                });
                if (promptMessage) {
                    try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }
                return;
            }

            const { ms, norm } = parsed;
            if (ms < MIN_MS || ms > MAX_MS) {
                const txt =
                    `❌ Out of range.\n\n` +
                    `<b>Minimum:</b> ${prettyMs(MIN_MS)}\n` +
                    `<b>Maximum:</b> ${prettyMs(MAX_MS)}\n\n` +
                    `Send again or Cancel.`;
                await safeEditOrSend(ctx, txt, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `PORN_DUR_CANCEL_${chatIdStr}`)]] }
                });
                if (promptMessage) {
                    try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }
                return;
            }

            await saveDuration(userId, chatIdStr, ms, norm);

            if (promptMessage) {
                try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
            }
            delete ctx.session.pornDurAwait;

            await ctx.reply(`✅ Duration set to ${prettyMs(ms)} (${norm}) for Porn penalty.`);
            await renderPornMenu(ctx, chatIdStr, userId, ok);
        } catch (e) {
            console.error("Porn duration handler error:", e);
            return next();
        }
    });
};
