const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const first_letter_uppercase = require("../helpers/first_letter_uppercase");

// Icons
const ICON = {
    off: "❌",
    warn: "❕",
    kick: "❗",
    mute: "🔇",
    ban: "🚫"
};

// Only these penalties support duration
const WITH_DURATION = new Set(["warn", "mute", "ban"]);

// Duration limits (ms)
const MIN_MS = 30 * 1000;                  // 30 seconds
const MAX_MS = 365 * 24 * 3600 * 1000;     // 365 days

// Media catalog
const MEDIA = [
    { key: "story", icon: "📰", name: "Story" },
    { key: "photo", icon: "🖼️", name: "Photo" },
    { key: "video", icon: "🎬", name: "Video" },
    { key: "album", icon: "🖼️📎", name: "Album" },
    { key: "gif", icon: "🎞️", name: "GIF" },
    { key: "voice", icon: "🎤", name: "Voice" },
    { key: "audio", icon: "🎧", name: "Audio" },
    { key: "sticker", icon: "🔖", name: "Sticker" },
    { key: "contacts", icon: "🏷", name: "Contacts" },
    { key: "animated_stickers", icon: "🌀", name: "Animated stickers" },
    { key: "animated_emoji", icon: "🙂", name: "Animated Emoji" },
    { key: "polls", icon: "📊", name: "Polls" },
    { key: "location", icon: "📍", name: "Location" },
    { key: "file", icon: "🗂️", name: "File" }
];

const esc = (s = "") =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

// human text -> { ms, norm }
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

function getState(doc, chatIdStr, key) {
    return doc?.settings?.[chatIdStr]?.media?.[key] || {};
}

// ----------------- Renderers -----------------
async function renderMediaHub(ctx, chatIdStr, userId, isOwner) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const lines = MEDIA.map(m => {
        const st = getState(userDoc, chatIdStr, m.key);
        const p = (st.punishment || "off").toLowerCase();
        const dur = WITH_DURATION.has(p) ? ` (${prettyMs(st.penalty_duration || 0)})` : "";
        const del = st.delete_messages ? "Yes ✅" : "No ❌";
        return `${m.icon} ${m.name}: ${p.toUpperCase()}${dur} • Delete: ${del}`;
    }).join("\n");

    // Intro explains that any member’s media is controlled by these rules
    const text =
        `<b>🎞️ Media Settings</b>\n\n` +
        `Use this panel to control what happens when any group member sends a specific kind of media (photo, video, GIF, sticker, etc.).\n` +
        esc(lines) +
        `\n\n<i>👉 Use the buttons below to control this setting for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`

    const rows = MEDIA.map(m => [Markup.button.callback(`${m.icon} ${m.name}`, `MEDIA_OPEN_${m.key}_${chatIdStr}`)]);
    rows.push([
        Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`),
    ]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderMediaDetail(ctx, chatIdStr, userId, key) {
    ctx.session = {}
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const def = MEDIA.find(m => m.key === key) || { name: key, icon: "🧩" };
    const st = getState(userDoc, chatIdStr, key);
    const p = (st.punishment || "off").toLowerCase();
    const durStr = st.penalty_duration_str || "None";
    const delOn = !!st.delete_messages;

    let header =
        `${def.icon} <b>${def.name}</b>\n\n` +
        `<b>Penalty</b>: ${first_letter_uppercase(p)}\n` +
        `<b>Delete Messages:</b> ${delOn ? "On ✅" : "Off ❌"}\n`;

    if (WITH_DURATION.has(p)) {
        header += `<b>Penalty duration:</b> ${esc(durStr)}\n\n`;
        header += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n`;
    }

    header += `\n<i>Select a button below to adjust settings:</i>`;

    const rows = [
        [
            Markup.button.callback(`${ICON.off} Off`, `MEDIA_SET_${key}_off_${chatIdStr}`),
            Markup.button.callback(`${ICON.warn} Warn`, `MEDIA_SET_${key}_warn_${chatIdStr}`),
            Markup.button.callback(`${ICON.kick} Kick`, `MEDIA_SET_${key}_kick_${chatIdStr}`)
        ],
        [
            Markup.button.callback(`${ICON.mute} Mute`, `MEDIA_SET_${key}_mute_${chatIdStr}`),
            Markup.button.callback(`${ICON.ban} Ban`, `MEDIA_SET_${key}_ban_${chatIdStr}`)
        ],
        [
            Markup.button.callback(`🗑 Delete Messages: ${delOn ? "✓" : "✗"}`, `MEDIA_TOGGLE_DELETE_${key}_${chatIdStr}`)
        ]
    ];

    // Show Set Duration only for warn/mute/ban with label specific to penalty
    if (WITH_DURATION.has(p)) {
        const label =
            p === "warn" ? `⏲️ Set Warn Duration (${durStr})`
                : p === "mute" ? `⏲️ Set Mute Duration (${durStr})`
                    : `⏲️ Set Ban Duration (${durStr})`;
        rows.push([Markup.button.callback(label, `MEDIA_DUR_OPEN_${key}_${chatIdStr}`)]);
    }

    rows.push([Markup.button.callback("⬅️ Back", `SET_MEDIA_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, header, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// Set penalty; initialize defaults only if missing
async function setPenalty(ctx, chatIdStr, userId, key, punishment) {
    const base = `settings.${chatIdStr}.media.${key}`;

    // Read only duration fields to decide if defaults need to be set
    const doc = await user_setting_module.findOne(
        { user_id: userId },
        { projection: { [`${base}.penalty_duration`]: 1, [`${base}.penalty_duration_str`]: 1 } }
    ).lean();

    const hasDur = !!(doc && doc.settings && doc.settings[chatIdStr] && doc.settings[chatIdStr].media
        && doc.settings[chatIdStr].media[key] && typeof doc.settings[chatIdStr].media[key].penalty_duration === "number");

    const hasDurStr = !!(doc && doc.settings && doc.settings[chatIdStr] && doc.settings[chatIdStr].media
        && doc.settings[chatIdStr].media[key] && typeof doc.settings[chatIdStr].media[key].penalty_duration_str === "string"
        && doc.settings[chatIdStr].media[key].penalty_duration_str.length > 0);

    const $set = { [`${base}.punishment`]: punishment };

    // Only initialize defaults if missing (regardless of punishment type)
    if (!hasDur) $set[`${base}.penalty_duration`] = 10 * 60 * 1000;
    if (!hasDurStr) $set[`${base}.penalty_duration_str`] = "10 minutes";

    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set },
        { upsert: true }
    );
}

// Toggle delete_messages boolean
async function toggleDelete(ctx, chatIdStr, userId, key) {
    const base = `settings.${chatIdStr}.media.${key}`;
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const current = !!(userDoc?.settings?.[chatIdStr]?.media?.[key]?.delete_messages);
    const newVal = !current;

    await user_setting_module.updateOne(
        { user_id: userId },
        {
            $setOnInsert: { user_id: userId },
            $set: { [`${base}.delete_messages`]: newVal }
        },
        { upsert: true }
    );
    return newVal;
}

// Duration prompt (Warn/Mute/Ban only)
async function openDurationPrompt(ctx, chatIdStr, userId, key) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const st = getState(userDoc, chatIdStr, key);
    const penalty = (st.punishment || "off").toLowerCase();

    if (!WITH_DURATION.has(penalty)) {
        await ctx.answerCbQuery("Duration is available only for Warn/Mute/Ban.", { show_alert: true });
        return;
    }

    const current = st.penalty_duration_str || "None";
    const example = "3 month 2 days 12 hours 4 minutes 34 seconds";

    const text =
        `⏲️ <b>Send now the duration for ${penalty.toUpperCase()} penalty</b>\n\n` +
        `<b>Minimum:</b> ${prettyMs(MIN_MS)}\n` +
        `<b>Maximum:</b> ${prettyMs(MAX_MS)}\n\n` +
        `<b>Example of format:</b> <code>${example}</code>\n\n` +
        `<b>Current duration:</b> ${esc(current)}\n\n`;

    const buttons = [
        [Markup.button.callback("🗑️ Remove duration", `MEDIA_DUR_REMOVE_${key}_${chatIdStr}`)],
        [Markup.button.callback("❌ Cancel", `MEDIA_DUR_CANCEL_${key}_${chatIdStr}`)]
    ];

    const sent = await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
    });

    // Track prompt message
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
    ctx.session.mediaDurAwait = {
        chatIdStr, userId, key,
        promptMessage: promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null
    };

    try { await ctx.answerCbQuery(); } catch (_) { }
}

async function saveDuration(userId, chatIdStr, key, ms, norm) {
    await user_setting_module.updateOne(
        { user_id: userId },
        {
            $setOnInsert: { user_id: userId },
            $set: {
                [`settings.${chatIdStr}.media.${key}.penalty_duration`]: ms,
                [`settings.${chatIdStr}.media.${key}.penalty_duration_str`]: norm
            }
        },
        { upsert: true }
    );
}

// ----------------- Module -----------------

module.exports = (bot) => {
    // Open hub
    bot.action(/^SET_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderMediaHub(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("SET_MEDIA error:", e); }
    });

    // Open detail
    bot.action(/^MEDIA_OPEN_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderMediaDetail(ctx, chatIdStr, userId, key);
        } catch (e) { console.error("MEDIA_OPEN error:", e); }
    });

    // Set penalty
    bot.action(/^MEDIA_SET_([a-z_]+)_(off|warn|kick|mute|ban)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const punishment = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await setPenalty(ctx, chatIdStr, userId, key, punishment);
            await ctx.answerCbQuery(`${(MEDIA.find(m => m.key === key)?.name) || key}: ${punishment.toUpperCase()}`);
            await renderMediaDetail(ctx, chatIdStr, userId, key);
        } catch (e) { console.error("MEDIA_SET error:", e); }
    });

    // Toggle delete_messages
    bot.action(/^MEDIA_TOGGLE_DELETE_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const newVal = await toggleDelete(ctx, chatIdStr, userId, key);
            await ctx.answerCbQuery(`Delete Messages: ${newVal ? "On" : "Off"}`);
            await renderMediaDetail(ctx, chatIdStr, userId, key);
        } catch (e) { console.error("MEDIA_TOGGLE_DELETE error:", e); }
    });

    // Open duration prompt
    bot.action(/^MEDIA_DUR_OPEN_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await openDurationPrompt(ctx, chatIdStr, userId, key);
        } catch (e) { console.error("MEDIA_DUR_OPEN error:", e); }
    });

    // Remove duration
    bot.action(/^MEDIA_DUR_REMOVE_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: {
                        [`settings.${chatIdStr}.media.${key}.penalty_duration`]: 0,
                        [`settings.${chatIdStr}.media.${key}.penalty_duration_str`]: "None"
                    }
                },
                { upsert: true }
            );

            if (ctx.session?.mediaDurAwait?.promptMessage) {
                const { chatId: pChatId, messageId: pMsgId } = ctx.session.mediaDurAwait.promptMessage;
                try { await ctx.telegram.deleteMessage(pChatId, pMsgId); } catch (_) { }
            }
            if (ctx.session?.mediaDurAwait) delete ctx.session.mediaDurAwait;

            await ctx.answerCbQuery("Duration removed");
            await renderMediaDetail(ctx, chatIdStr, userId, key);
        } catch (e) { console.error("MEDIA_DUR_REMOVE error:", e); }
    });

    // Cancel duration prompt
    bot.action(/^MEDIA_DUR_CANCEL_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await ctx.answerCbQuery("Cancelled");
            await renderMediaDetail(ctx, chatIdStr, userId, key);
        } catch (e) { console.error("MEDIA_DUR_CANCEL error:", e); }
    });

    // Capture duration text
    bot.on("text", async (ctx, next) => {
        try {
            const awaitObj = ctx.session?.mediaDurAwait;
            if (!awaitObj) return next();

            const { chatIdStr, userId, key, promptMessage } = awaitObj;
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
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `MEDIA_DUR_CANCEL_${key}_${chatIdStr}`)]] }
                });
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
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `MEDIA_DUR_CANCEL_${key}_${chatIdStr}`)]] }
                });
                return;
            }

            await saveDuration(userId, chatIdStr, key, ms, norm);

            if (promptMessage) {
                try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
            }
            delete ctx.session.mediaDurAwait;

            await ctx.reply(`✅ Duration set to ${prettyMs(ms)} (${norm}) for ${(MEDIA.find(m => m.key === key)?.name) || key}.`);
            await renderMediaDetail(ctx, chatIdStr, userId, key);
        } catch (e) {
            console.error("MEDIA duration text handler error:", e);
            return next();
        }
    });
};
