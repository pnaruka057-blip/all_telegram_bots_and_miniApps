const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");
const moment = require("moment-timezone"); // add this

// ---- Helpers -------------------------------------------------

// Add this helper near your other helpers
function getTZ(doc, chatIdStr) {
    return doc?.settings?.[chatIdStr]?.time_zone || {};
}

// Time string in selected zone; accepts IANA like "Asia/Kolkata" or "GMT+05:30"
function nowInZone(tzName) {
    if (tzName && moment.tz.zone(tzName)) {
        return moment().tz(tzName).format("DD/MM/YYYY hh:mm A");
    }

    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzName || "");
    if (m) {
        const sign = m[1] === "-" ? -1 : 1;
        const hh = parseInt(m[2], 10);
        const mm = parseInt(m[3], 10);
        const offsetMin = sign * (hh * 60 + mm);
        return moment().utcOffset(offsetMin).format("DD/MM/YYYY hh:mm A");
    }

    // Fallback: server time
    return moment().format("DD/MM/YYYY hh:mm A");
}

const pad2 = n => String(n).padStart(2, "0");

const yn = b => b ? "Yes ✅" : "No ❌";

async function ensureArray(userId, chatIdStr) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const items = doc?.settings?.[chatIdStr]?.recurring?.items;
    if (!Array.isArray(items)) {
        await user_setting_module.updateOne(
            { user_id: userId },
            { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.recurring.items`]: [] } },
            { upsert: true }
        );
        return [];
    }
    return items;
}
function itemPath(chatIdStr, idx, path) {
    return `settings.${chatIdStr}.recurring.items.${idx}.${path}`;
}

function fmtTime(t) {
    if (!t || typeof t.h !== "number") return "—";
    const h = pad2(t.h), m = pad2(t.m || 0);
    return `${h}:${m}`;
}
function fmtRepetition(rep) {
    if (!rep) return "—";
    if (rep.per_messages && rep.per_messages > 0) return `Every ${rep.per_messages} messages`;
    const h = rep.hours || 0, m = rep.minutes || 0;
    if (h && m) return `Every ${h}h ${m}m`;
    if (h) return `Every ${h} hours`;
    if (m) return `Every ${m} minutes`;
    return "—";
}
function fmtItemSummary(it, idx) {
    const on = it.enabled === true ? "On ✅" : "Off ❌";
    const t = fmtTime(it.start_time);
    const rep = fmtRepetition(it.repetition);
    const hasText = it.text && it.text.trim().length > 0;
    const hasMedia = it.media && it.media.type && it.media.file_id;
    const hasBtns = Array.isArray(it.url_buttons) && it.url_buttons.length > 0;
    return (
        `${it.topic_id ? "🗂 " : ""}• ${idx + 1} - ${on}\n` +
        `├ <b>Time</b>: ${t}\n` +
        `├ <b>Repetition</b>: ${rep}\n` +
        `└ ${hasText ? "Text set" : "Message is not set."}${hasMedia ? " • Media set" : ""}${hasBtns ? " • Buttons set" : ""}`
    );
}

function defaultsItem() {
    return {
        enabled: false,
        start_time: { h: 9, m: 11 }, // screenshot-like default
        repetition: { hours: 24, minutes: 0 },
        text: "",
        media: { type: null, file_id: null, caption: "" },
        url_buttons: [],
        pin: false,
        delete_last: false,
        message_check: true,
        days_of_week: [],   // 0..6
        days_of_month: [],  // 1..31
        slot: { from: null, to: null },
        start_date: null,
        end_date: null,
        topic_id: null
    };
}

// New helpers: config checks
function isTimeConfigured(it) {
    const h = it?.start_time?.h;
    return Number.isInteger(h) && h >= 0 && h <= 23;
}

function isRepetitionConfigured(it) {
    const rep = it?.repetition || {};
    const hp = Number(rep.hours) || 0;
    const mp = Number(rep.minutes) || 0;
    const pm = Number(rep.per_messages) || 0;
    return hp > 0 || mp > 0 || pm > 0;
}

// ---- Renderers -----------------------------------------------

// Main hub
async function renderMain(ctx, chatIdStr, userId, isOwner) {
    ctx.session = {}; // clear session on main render
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const items = await ensureArray(userId, chatIdStr);

    const tzName = getTZ(doc, chatIdStr)?.tz_name || null;
    const head =
        `🕓 <b>Recurring messages</b>\n` +
        `From this menu set messages that will be sent repeatedly to the group at intervals or after N messages.\n\n` +
        `Current time: ${nowInZone(tzName)}`;

    const rows = [];

    // Add message
    rows.push([Markup.button.callback("➕ Add message", `RC_ADD_${chatIdStr}`)]);

    // Messages list
    if (items.length) {
        for (let i = 0; i < items.length; i++) {
            rows.push([
                Markup.button.callback(`💬 ${i + 1}`, `RC_OPEN_${i}_${chatIdStr}`),
                Markup.button.callback("👀 See", `RC_PREVIEW_${i}_${chatIdStr}`),
                Markup.button.callback("🗑", `RC_DEL_${i}_${chatIdStr}`)
            ]);
        }
        // Keep status toggle summary row if you like (optional)
        rows.push([
            Markup.button.callback("🗑 Delete all", `RC_DEL_ALL_${chatIdStr}`)
        ]);
    }

    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    const body = items.length
        ? items.map((it, i) => fmtItemSummary(it, i)).join("\n\n")
        : "No recurring messages yet.";

    let text = `${head}\n\n${body}`;
    if (isOwner?.title) {
        text += `\n\n<i>Select button to config this setting for <b>${isOwner.title}</b>.</i>`;
    }

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Item overview with full action stack (like screenshot)
async function renderItemOverview(ctx, chatIdStr, userId, idx) {
    ctx.session = {}; // clear session on main render
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
    const text =
        `🕓 <b>Recurring messages</b>\n\n` +
        `💡 <b>Status</b>: ${it.enabled ? "On ✅" : "Off ❌"}\n` +
        `⏰ <b>Time</b>: ${fmtTime(it.start_time)}\n` +
        `⏳ <b>Repetition</b>: ${fmtRepetition(it.repetition)}\n` +
        `📌 <b>Pin message</b>: ${yn(!!it.pin)}\n` +
        `♻️ <b>Delete last message</b>: ${yn(!!it.delete_last)}\n`;

    const rows = [
        // New top row: explicit ON / OFF for this item
        [Markup.button.callback("✅ Turn on", `RC_ITEM_SET_on_${idx}_${chatIdStr}`),
        Markup.button.callback("❌ Turn off", `RC_ITEM_SET_off_${idx}_${chatIdStr}`)],

        [Markup.button.callback("👋 Customize message", `RC_CUST_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🕒 Time", `RC_TIME_${idx}_${chatIdStr}`), Markup.button.callback("🗓 Repetition", `RC_REP_${idx}_${chatIdStr}`)],
        [Markup.button.callback("📅 Days of the week", `RC_DOW_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🗓 Days of the month", `RC_DOM_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🕰 Set time slot", `RC_SLOT_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🗓 Start date", `RC_SDATE_${idx}_${chatIdStr}`), Markup.button.callback("🗓 End date", `RC_EDATE_${idx}_${chatIdStr}`)],
        [Markup.button.callback(`${it.pin ? "📌 Unpin" : "📌 Pin"} message`, `RC_PIN_${idx}_${chatIdStr}`)],
        [Markup.button.callback(`${it.delete_last ? "♻️ Don’t delete last" : "♻️ Delete last message"}`, `RC_LASTDEL_${idx}_${chatIdStr}`)],
        [Markup.button.callback("♻️ Scheduled deletion", `RC_SCHED_${idx}_${chatIdStr}`)], // placeholder
        [Markup.button.callback("⬅️ Back", `RECURRING_MESSAGES_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Compact composer (content setup)
async function renderComposer(ctx, chatIdStr, userId, idx) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || defaultsItem();

    const textSet = it.text && it.text.trim().length > 0;
    const mediaSet = it.media && it.media.type && it.media.file_id;
    const btnsSet = Array.isArray(it.url_buttons) && it.url_buttons.length > 0;

    const text =
        `🕓 <b>Recurring message</b>\n\n` +
        `${textSet ? "Text" : "Text"} ${textSet ? "✅" : "❌"}\n` +
        `${mediaSet ? "Media" : "Media"} ${mediaSet ? "✅" : "❌"}\n` +
        `${btnsSet ? "Url Buttons" : "Url Buttons"} ${btnsSet ? "✅" : "❌"}\n\n` +
        `👉 Choose what you want to set.`;

    const rows = [
        [Markup.button.callback("📄 Text", `RC_SET_TEXT_${idx}_${chatIdStr}`), Markup.button.callback("👀 See", `RC_SEE_TEXT_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🖼 Media", `RC_SET_MEDIA_${idx}_${chatIdStr}`), Markup.button.callback("👀 See", `RC_SEE_MEDIA_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🔠 Url Buttons", `RC_SET_BTNS_${idx}_${chatIdStr}`), Markup.button.callback("👀 See", `RC_SEE_BTNS_${idx}_${chatIdStr}`)],
        [Markup.button.callback("👀 Full preview", `RC_PREVIEW_${idx}_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `RECURRING_MESSAGES_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Repetition
async function renderRepetition(ctx, chatIdStr, userId, idx) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const rep = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.repetition || {};
    const cur = fmtRepetition(rep);
    const text =
        `🕓 <b>Recurring messages</b>\n\n` +
        `⏳ <b>Repetition</b>: ${cur}\n\n` +
        `👉 Select how often the message should be repeated.`;

    const hoursRow1 = [1, 2, 3, 4].map(h => Markup.button.callback(`${h}${rep.hours === h ? " ✅" : ""}`, `RC_REP_H_${idx}_${h}_${chatIdStr}`));
    const hoursRow2 = [6, 8, 12, 24].map(h => Markup.button.callback(`${h}${rep.hours === h ? " ✅" : ""}`, `RC_REP_H_${idx}_${h}_${chatIdStr}`));
    const minRow = [5, 10, 15, 20, 30].map(m => Markup.button.callback(`${m}`, `RC_REP_M_${idx}_${m}_${chatIdStr}`));

    const rows = [hoursRow1, hoursRow2, minRow, [Markup.button.callback("🔁 Repeat every few messages", `RC_REP_PERMSG_${idx}_${chatIdStr}`)], [Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Start hour picker
async function renderTimeHourPicker(ctx, chatIdStr, userId, idx) {
    const text = `🕓 <b>Recurring messages</b>\n\n👉 Select the start time (hour).`;
    const rows = [];
    for (let i = 0; i < 24; i += 4) {
        const r = [];
        for (let j = i; j < i + 4; j++) r.push(Markup.button.callback(`${j}`, `RC_TIME_H_${idx}_${j}_${chatIdStr}`));
        rows.push(r);
    }
    rows.push([Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]);
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Confirm delete
async function renderConfirmDelete(ctx, chatIdStr, userId, idx) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
    const text =
        `🕓 <b>Recurring messages</b>\n\n` +
        `⚠️ Are you sure you want to delete this message?\n` +
        `├ <b>Time</b>: ${fmtTime(it.start_time)}\n` +
        `├ <b>Repetition</b>: ${fmtRepetition(it.repetition)}\n` +
        `└ ${it.text ? "Message set." : "Message is not set."}`;
    const rows = [
        [Markup.button.callback("✅ Confirm deletion", `RC_DEL_OK_${idx}_${chatIdStr}`)],
        [Markup.button.callback("❌ Cancel", `RECURRING_MESSAGES_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}
// ---- Routes (entry + module level) ---------------------------
module.exports = (bot) => {
    // Entry
    bot.action(/^RECURRING_MESSAGES_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderMain(ctx, chatIdStr, userId, ok);
    });

    // Set this item ON (redirect to Time if Time/Repetition not set)
    bot.action(/^RC_ITEM_SET_on_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

        let needsSetup = false;
        try {
            const doc2 = await user_setting_module.findOne({ user_id: userId }).lean();
            const it2 = doc2?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
            needsSetup = !isTimeConfigured(it2) || !isRepetitionConfigured(it2);
        } catch { /* ignore */ }

        if (needsSetup) {
            try { await ctx.answerCbQuery("Set time and repetition first"); } catch { }
            return renderTimeHourPicker(ctx, chatIdStr, userId, idx);
        }
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "enabled")]: true } }
        );
        try { await ctx.answerCbQuery("Message ON"); } catch { }
        return renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Set this item OFF
    bot.action(/^RC_ITEM_SET_off_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "enabled")]: false } }
        );
        try { await ctx.answerCbQuery("Message OFF"); } catch { }
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Delete all
    bot.action(/^RC_DEL_ALL_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.recurring.items`]: [] } }
        );
        try { await ctx.answerCbQuery("All messages deleted"); } catch { }
        await renderMain(ctx, chatIdStr, userId, ok);
    });

    // Add -> composer
    bot.action(/^RC_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const items = await ensureArray(userId, chatIdStr);
        const idx = items.length;
        await renderComposer(ctx, chatIdStr, userId, idx);
    });

    // Open item -> FULL OVERVIEW (fix for 💬 buttons)
    bot.action(/^RC_OPEN_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Toggle one item on/off (redirect to Time if turning ON without Time/Repetition)
    bot.action(/^RC_TOGGLE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        const nextEnabled = !it.enabled;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "enabled")]: nextEnabled } });
        try { await ctx.answerCbQuery(nextEnabled ? "Turned ON" : "Turned OFF"); } catch { }
        if (nextEnabled && (!isTimeConfigured(it) || !isRepetitionConfigured(it))) {
            return renderTimeHourPicker(ctx, chatIdStr, userId, idx);
        }
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Delete single (confirm then do)
    bot.action(/^RC_DEL_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderConfirmDelete(ctx, chatIdStr, userId, idx);
    });

    bot.action(/^RC_DEL_OK_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]);
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        // Load fresh items
        const items = await ensureArray(userId, chatIdStr);

        if (idx < 0 || idx >= items.length) {
            try { await ctx.answerCbQuery("Item not found"); } catch { }
            return renderMain(ctx, chatIdStr, userId, ok);
        }

        items.splice(idx, 1);

        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.recurring.items`]: items } }
        );

        try { await ctx.answerCbQuery("Deleted"); } catch { }
        await renderMain(ctx, chatIdStr, userId, ok);
    });

    // Composer navigation
    bot.action(/^RC_CUST_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderComposer(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_TIME_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderTimeHourPicker(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_REP_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderRepetition(ctx, chatIdStr, userId, idx);
    });

    // Set start hour (returns to overview)
    bot.action(/^RC_TIME_H_(\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const hour = Number(ctx.match[2]); const chatIdStr = ctx.match[3]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "start_time")]: { h: hour, m: 0 } } });
        try { await ctx.answerCbQuery(`Start time: ${pad2(hour)}:00`); } catch { }
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Repetition picks
    bot.action(/^RC_REP_H_(\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const h = Number(ctx.match[2]); const chatIdStr = ctx.match[3]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "repetition.hours")]: h, [itemPath(chatIdStr, idx, "repetition.per_messages")]: null } }
        );
        await renderRepetition(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_REP_M_(\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const m = Number(ctx.match[2]); const chatIdStr = ctx.match[3]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "repetition.minutes")]: m, [itemPath(chatIdStr, idx, "repetition.per_messages")]: null } }
        );
        await renderRepetition(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_REP_PERMSG_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_permsg", chatIdStr, idx } };
        await safeEditOrSend(ctx, "Send how many messages between repeats (integer, e.g., 20).", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] }
        });
    });

    // Pin / delete-last toggles
    bot.action(/^RC_PIN_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "pin")]: !it.pin } });
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_LASTDEL_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "delete_last")]: !it.delete_last } });
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Composer – Text
    bot.action(/^RC_SET_TEXT_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const message_id = await safeEditOrSend(ctx, "👉 Send now the message you want to set.\nYou can send it already formatted or use HTML.", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("🚫 Remove message", `RC_TEXT_REMOVE_${idx}_${chatIdStr}`)], [Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]] }
        }, true);
        ctx.session = { await: { mode: "rc_text", chatIdStr, idx }, message_id };
    });
    bot.action(/^RC_TEXT_REMOVE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "text")]: "" } });
        await renderComposer(ctx, chatIdStr, userId, idx);
        ctx.session = {};
    });
    bot.action(/^RC_SEE_TEXT_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]);
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const text = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.text || "—";

        // ⚠️ Do NOT escape HTML if you want formatting to work
        await ctx.reply(`${text}`, {
            parse_mode: "HTML"
        });
    });

    // Composer – Media
    bot.action(/^RC_SET_MEDIA_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const message_id = await safeEditOrSend(ctx, "👉 Send now the media (photo, video, sticker, document...) you want to set.\nYou can also enter a caption.", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("🚫 Remove message", `RC_MEDIA_REMOVE_${idx}_${chatIdStr}`)], [Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]] }
        }, true);
        ctx.session = { await: { mode: "rc_media", chatIdStr, idx }, message_id };
    });
    bot.action(/^RC_MEDIA_REMOVE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "media")]: { type: null, file_id: null, caption: "" } } });
        await renderComposer(ctx, chatIdStr, userId, idx);
        ctx.session = {};
    });
    bot.action(/^RC_SEE_MEDIA_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]);
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const m = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.media;

        if (!m?.type || !m?.file_id) {
            return ctx.reply("No media found for this item.");
        }

        // 🔹 Send media based on its type
        switch (m.type) {
            case "photo":
                await ctx.replyWithPhoto(m.file_id, {
                    caption: m.caption || "",
                    parse_mode: "HTML",
                });
                break;

            case "video":
                await ctx.replyWithVideo(m.file_id, {
                    caption: m.caption || "",
                    parse_mode: "HTML",
                });
                break;

            case "document":
                await ctx.replyWithDocument(m.file_id, {
                    caption: m.caption || "",
                    parse_mode: "HTML",
                });
                break;

            case "sticker":
                await ctx.replyWithSticker(m.file_id);
                break;

            default:
                await ctx.reply("Unsupported media type.");
        }
    });

    // Composer – URL Buttons
    bot.action(/^RC_SET_BTNS_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]);
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        // 🔗 Builder tool link + message (HTML enabled)
        const builderUrl = process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE; // replace with your real tool if available
        const textMsg =
            `👉🏻 <b>Send now the Buttons</b> you want to set.\n\n` +
            `If you need a visual tool to build the buttons and get the exact code, ` +
            `<a href="${builderUrl}/buttons-design">Click Here</a>.\n\n`;

        const message_id = await safeEditOrSend(ctx, textMsg, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback("🚫 Remove message", `RC_REMOVE_KEYWORD_${idx}_${chatIdStr}`)],
                    [Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)],
                ]
            }
        });

        ctx.session = { await: { mode: "rc_btns", chatIdStr, idx }, message_id };
    });

    bot.action(/^RC_SEE_BTNS_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const btns = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.url_buttons || [];
        const info = btns.length ? JSON.stringify(btns) : "—";
        await safeEditOrSend(ctx, `Current URL buttons:\n\n<code>${info.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
        ctx.session = {};
    });

    bot.action(/^RC_REMOVE_KEYWORD_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]);
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        await user_setting_module.updateOne(
            { user_id: userId },
            { $unset: { [itemPath(chatIdStr, idx, "keyword")]: "" } } // or "buttons_keyword" etc., as needed
        );

        try { await ctx.answerCbQuery("Keyword removed."); } catch { }
        // Clean up current inline message for a neat UX (optional)
        try { await ctx.deleteMessage(); } catch { }

        // Re-open composer or confirm:
        return renderComposer(ctx, chatIdStr, userId, idx);
    });

    // Topic placeholder
    bot.action(/^RC_TOPIC_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await safeEditOrSend(ctx, "Topic selection coming soon.", { reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
    });

    // Days of week
    bot.action(/^RC_DOW_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const arr = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.days_of_week || [];
        const has = d => arr.includes(d);
        const text = `🕓 <b>Recurring messages</b>\n\nSelect days of the week (toggle).`;
        const row = (ds) => ds.map(d => Markup.button.callback(`${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]} ${has(d) ? "✅" : "✖️"}`, `RC_DOW_T_${idx}_${d}_${chatIdStr}`));
        const rows = [row([0, 1, 2, 3]), row([4, 5, 6]), [Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]];
        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
    });
    bot.action(/^RC_DOW_T_(\d+)_(\d)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const day = Number(ctx.match[2]); const chatIdStr = ctx.match[3]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const arr = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.days_of_week || [];
        const next = arr.includes(day) ? arr.filter(x => x !== day) : [...arr, day].sort((a, b) => a - b);
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "days_of_week")]: next } });
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Days of month
    bot.action(/^RC_DOM_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const arr = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.days_of_month || [];
        const has = d => arr.includes(d);
        const text = `🕓 <b>Recurring messages</b>\n\nSelect days of the month (toggle).`;
        const rows = [];
        for (let i = 1; i <= 31; i += 7) {
            const r = [];
            for (let j = i; j < i + 7 && j <= 31; j++) r.push(Markup.button.callback(`${j} ${has(j) ? "✅" : "✖️"}`, `RC_DOM_T_${idx}_${j}_${chatIdStr}`));
            rows.push(r);
        }
        rows.push([Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]);
        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
    });
    bot.action(/^RC_DOM_T_(\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const day = Number(ctx.match[2]); const chatIdStr = ctx.match[3]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const arr = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.days_of_month || [];
        const next = arr.includes(day) ? arr.filter(x => x !== day) : [...arr, day].sort((a, b) => a - b);
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "days_of_month")]: next } });
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Slot, dates (via text prompt)
    bot.action(/^RC_SLOT_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_slot", chatIdStr, idx, phase: "from" } };
        await safeEditOrSend(ctx, "Send slot FROM hour (0-23). Then send slot TO hour (0-23).", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
    });
    bot.action(/^RC_SDATE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_sdate", chatIdStr, idx } };
        await safeEditOrSend(ctx, "Send start date in DD/MM/YYYY.", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
    });
    bot.action(/^RC_EDATE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_edate", chatIdStr, idx } };
        await safeEditOrSend(ctx, "Send end date in DD/MM/YYYY.", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
    });

    // Text input handling (text, per-message, slot, dates, buttons)
    bot.on("text", async (ctx, next) => {
        const st = ctx.session?.await; if (!st) return next && next();
        const { mode, chatIdStr, idx } = st;
        const userId = ctx.from.id;
        if (!chatIdStr) return next && next();

        if (mode === "rc_text") {
            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [itemPath(chatIdStr, idx, "text")]: ctx.message.text } }
            );

            // 🔹 Agar session me message_id hai to us message ko delete karo
            if (ctx.session?.message_id) {
                try {
                    await ctx.deleteMessage(ctx.session.message_id);
                } catch (error) {
                    console.error("Message delete karte waqt error:", error.message);
                }
            }
            ctx.session = {};

            // Composer render karo
            return renderComposer(ctx, chatIdStr, userId, idx);
        }
        if (mode === "rc_btns") {
            const parsed = parseButtonsSyntax(ctx.message.text || "");
            await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "url_buttons")]: parsed || [] } });
            ctx.session = {};
            return renderComposer(ctx, chatIdStr, userId, idx);
        }
        if (mode === "rc_permsg") {
            const n = Math.max(1, Math.min(100000, parseInt(ctx.message.text, 10) || 0));
            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [itemPath(chatIdStr, idx, "repetition.per_messages")]: n, [itemPath(chatIdStr, idx, "repetition.hours")]: 0, [itemPath(chatIdStr, idx, "repetition.minutes")]: 0 } }
            );
            ctx.session = {};
            return renderItemOverview(ctx, chatIdStr, userId, idx);
        }
        if (mode === "rc_slot") {
            const phase = st.phase;
            const val = Math.max(0, Math.min(23, parseInt(ctx.message.text, 10) || 0));
            if (phase === "from") {
                ctx.session.await = { mode: "rc_slot", chatIdStr, idx, phase: "to", from: val };
                return safeEditOrSend(ctx, `FROM: ${val}\nNow send slot TO hour (0-23).`, {
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] }
                });
            } else {
                const from = st.from;
                await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "slot")]: { from, to: val } } });
                ctx.session = {};
                return renderItemOverview(ctx, chatIdStr, userId, idx);
            }
        }
        if (mode === "rc_sdate" || mode === "rc_edate") {
            // Strict DD/MM/YYYY
            const m = moment(ctx.message.text, "DD/MM/YYYY", true);
            const valid = m.isValid();
            if (valid) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [itemPath(chatIdStr, idx, mode === "rc_sdate" ? "start_date" : "end_date")]: m.toDate().toISOString() } }
                );
                ctx.session = {};
                return renderItemOverview(ctx, chatIdStr, userId, idx);
            } else {
                return safeEditOrSend(ctx, "Invalid date. Send DD/MM/YYYY.", {
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] }
                });
            }
        }
        return next && next();
    });

    // Media capture
    bot.on(["photo", "video", "document", "sticker"], async (ctx, next) => {
        const st = ctx.session?.await;
        if (!st || st.mode !== "rc_media") return next && next();

        const { chatIdStr, idx } = st;
        const userId = ctx.from.id;

        let type = null, file_id = null;

        if (ctx.message.photo) {
            type = "photo";
            file_id = ctx.message.photo.at(-1).file_id;
        } else if (ctx.message.video) {
            type = "video";
            file_id = ctx.message.video.file_id;
        } else if (ctx.message.document) {
            type = "document";
            file_id = ctx.message.document.file_id;
        } else if (ctx.message.sticker) {
            type = "sticker";
            file_id = ctx.message.sticker.file_id;
        }

        const caption = ctx.message.caption || "";

        if (type && file_id) {
            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [itemPath(chatIdStr, idx, "media")]: { type, file_id, caption } } }
            );

            // 🔹 Delete the message stored in ctx.session.message_id if it exists
            if (ctx.session?.message_id) {
                try {
                    await ctx.deleteMessage(ctx.session.message_id);
                } catch (error) {
                    console.error("Message delete karte waqt error:", error.message);
                }
            }

            // 🔹 Clear session
            ctx.session = {};

            // 🔹 Continue rendering next step
            return renderComposer(ctx, chatIdStr, userId, idx);
        }

        return safeEditOrSend(ctx, "Unsupported media. Send photo/video/document/sticker.", {
            reply_markup: {
                inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]]
            }
        });
    });

    // Preview one message (from list or composer)
    bot.action(/^RC_PREVIEW_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        const btnRows = (it.url_buttons || []).map(row => row.map(b => Markup.button.url(b.text, b.url)));
        const keyboard = btnRows.length ? { inline_keyboard: btnRows } : undefined;

        if (it.media?.type && it.media?.file_id) {
            const cap = it.media.caption || it.text || "";
            switch (it.media.type) {
                case "photo": await ctx.replyWithPhoto(it.media.file_id, { caption: cap, parse_mode: "HTML", reply_markup: keyboard }); break;
                case "video": await ctx.replyWithVideo(it.media.file_id, { caption: cap, parse_mode: "HTML", reply_markup: keyboard }); break;
                case "document": await ctx.replyWithDocument(it.media.file_id, { caption: cap, parse_mode: "HTML", reply_markup: keyboard }); break;
                case "sticker": await ctx.replyWithSticker(it.media.file_id); break;
                default: await ctx.reply(cap || "—", { parse_mode: "HTML", reply_markup: keyboard });
            }
        } else {
            await ctx.reply(it.text || "—", { parse_mode: "HTML", reply_markup: keyboard });
        }
    });
}