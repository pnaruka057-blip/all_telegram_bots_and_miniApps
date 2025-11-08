// recurring-messages.js
const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const parseButtonsSyntax = require("../helpers/parseButtonsSyntax");

// ---- Helpers -------------------------------------------------
const pad2 = n => String(n).padStart(2, "0");
const nowLocal = () => {
    const d = new Date(); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const yn = b => b ? "Yes ✅" : "No ❌";
const tick = b => b ? "✅" : "✖️";
const hoursChoices = [1, 2, 3, 4, 6, 8, 12, 24];
const minutesChoices = [5, 10, 15, 20, 30];

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
    const on = it.enabled === true ? "On ✅" : "off ❌";
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

// ---- Renderers -----------------------------------------------
async function renderList(ctx, chatIdStr, userId) {
    const items = await ensureArray(userId, chatIdStr);
    const head =
        `🕓 <b>Recurring messages</b>\n` +
        `From this menu you can set messages that will be sent repeatedly to the group every few minutes/hours or every few messages.\n\n` +
        `Current time: ${nowLocal()}`;
    const body = items.length
        ? items.map((it, i) => fmtItemSummary(it, i)).join("\n\n")
        : "No recurring messages yet.";
    const text = `${head}\n\n${body}`;

    const rows = [];
    rows.push([Markup.button.callback("➕ Add message", `RC_ADD_${chatIdStr}`)]);
    if (items.length) {
        // first row: open first, toggle off/on, delete (shortcut like screenshot)
        rows.push([
            Markup.button.callback("💬 1", `RC_OPEN_0_${chatIdStr}`),
            Markup.button.callback("❌ Off", `RC_TOGGLE_0_${chatIdStr}`),
            Markup.button.callback("🗑", `RC_DEL_0_${chatIdStr}`)
        ]);
    }
    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderCustomize(ctx, chatIdStr, userId, idx) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
    const textSet = it.text && it.text.trim().length > 0;
    const mediaSet = it.media && it.media.type && it.media.file_id;
    const btnsSet = Array.isArray(it.url_buttons) && it.url_buttons.length > 0;

    const text =
        `🕓 <b>Recurring messages</b>\n\n` +
        `${textSet ? "Text" : "Text"} ${textSet ? "✅" : "❌"}\n` +
        `${mediaSet ? "Media" : "Media"} ${mediaSet ? "✅" : "❌"}\n` +
        `${btnsSet ? "Url Buttons" : "Url Buttons"} ${btnsSet ? "✅" : "❌"}\n\n` +
        `👉 Use the buttons below to choose what you want to set`;

    const rows = [
        [Markup.button.callback("📄 Text", `RC_SET_TEXT_${idx}_${chatIdStr}`), Markup.button.callback("👀 See", `RC_SEE_TEXT_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🖼 Media", `RC_SET_MEDIA_${idx}_${chatIdStr}`), Markup.button.callback("👀 See", `RC_SEE_MEDIA_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🔠 Url Buttons", `RC_SET_BTNS_${idx}_${chatIdStr}`), Markup.button.callback("👀 See", `RC_SEE_BTNS_${idx}_${chatIdStr}`)],
        [Markup.button.callback("👀 Full preview", `RC_PREVIEW_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🗂 Select a Topic", `RC_TOPIC_${idx}_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderRepetition(ctx, chatIdStr, userId, idx) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const rep = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.repetition || {};
    const cur = fmtRepetition(rep);
    const text =
        `🕓 <b>Recurring messages</b>\n\n` +
        `⏳ <b>Repetition</b>: ${cur}\n\n` +
        `👉 Select how often the message should be repeated.`;

    const rows = [];
    // Hours line(s)
    const hrRow1 = [1, 2, 3, 4].map(h => Markup.button.callback(`${h}${rep.hours === h ? " ✅" : ""}`, `RC_REP_H_${idx}_${h}_${chatIdStr}`));
    const hrRow2 = [6, 8, 12, 24].map(h => Markup.button.callback(`${h}${rep.hours === h ? " ✅" : ""}`, `RC_REP_H_${idx}_${h}_${chatIdStr}`));
    rows.push(hrRow1, hrRow2);

    // Minutes (only allowed choices like screenshot)
    const minRow = minutesChoices.map(m => Markup.button.callback(`${m}`, `RC_REP_M_${idx}_${m}_${chatIdStr}`));
    rows.push(minRow);

    rows.push([Markup.button.callback("🔁 Repeat every few messages", `RC_REP_PERMSG_${idx}_${chatIdStr}`)]);
    rows.push([Markup.button.callback("⬅️ Back", `RC_OPEN_${idx}_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

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

async function renderItemOverview(ctx, chatIdStr, userId, idx) {
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
        [Markup.button.callback("👋 Customize message", `RC_CUST_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🕒 Time", `RC_TIME_${idx}_${chatIdStr}`), Markup.button.callback("🗓 Repetition", `RC_REP_${idx}_${chatIdStr}`)],
        [Markup.button.callback("📅 Days of the week", `RC_DOW_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🗓 Days of the month", `RC_DOM_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🕰 Set time slot", `RC_SLOT_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🗓 Start date", `RC_SDATE_${idx}_${chatIdStr}`), Markup.button.callback("🗓 End date", `RC_EDATE_${idx}_${chatIdStr}`)],
        [Markup.button.callback(`${it.pin ? "📌 Unpin" : "📌 Pin"} message`, `RC_PIN_${idx}_${chatIdStr}`)],
        [Markup.button.callback(`${it.delete_last ? "♻️ Don’t delete last" : "♻️ Delete last message"}`, `RC_LASTDEL_${idx}_${chatIdStr}`)],
        [Markup.button.callback("🗑 Delete", `RC_DEL_${idx}_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `RECURRING_MESSAGES_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderConfirmDelete(ctx, chatIdStr, userId, idx) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
    const text =
        `🕓 <b>Recurring messages</b>\n\n` +
        `⚠️ Are you really sure you want to delete this message?\n` +
        `├ <b>Time</b>: ${fmtTime(it.start_time)}\n` +
        `├ <b>Repetition</b>: ${fmtRepetition(it.repetition)}\n` +
        `└ ${it.text ? "Message set." : "Message is not set."}`;
    const rows = [
        [Markup.button.callback("✅ Confirm deletion", `RC_DEL_OK_${idx}_${chatIdStr}`)],
        [Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ---- Module routes ------------------------------------------
module.exports = (bot) => {

    // Entry point
    bot.action(/^RECURRING_MESSAGES_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderList(ctx, chatIdStr, userId);
    });

    // Add
    bot.action(/^RC_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        // push a default item
        const defaults = {
            enabled: false,
            start_time: { h: 0, m: 0 },
            repetition: { hours: 24, minutes: 0 },
            text: "",
            media: { type: null, file_id: null, caption: "" },
            url_buttons: [],
            pin: false,
            delete_last: false,
            message_check: true,
            days_of_week: [],    // 0..6
            days_of_month: [],   // 1..31
            slot: { from: null, to: null },
            start_date: null,
            end_date: null,
            topic_id: null
        };
        await user_setting_module.updateOne(
            { user_id: userId },
            { $setOnInsert: { user_id: userId }, $push: { [`settings.${chatIdStr}.recurring.items`]: defaults } },
            { upsert: true }
        );
        await renderList(ctx, chatIdStr, userId);
    });

    // Open item
    bot.action(/^RC_OPEN_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Toggle on/off (shortcut)
    bot.action(/^RC_TOGGLE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "enabled")]: !it.enabled } }
        );
        try { await ctx.answerCbQuery(!it.enabled ? "Turned ON" : "Turned OFF"); } catch { }
        await renderList(ctx, chatIdStr, userId);
    });

    // Delete confirm + do
    bot.action(/^RC_DEL_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderConfirmDelete(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_DEL_OK_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        // pull by index: use $unset + $pull nulls or rebuild array, here rebuild
        const items = await ensureArray(userId, chatIdStr);
        items.splice(idx, 1);
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.recurring.items`]: items } }
        );
        try { await ctx.answerCbQuery("Deleted"); } catch { }
        await renderList(ctx, chatIdStr, userId);
    });

    // Overview navigations
    bot.action(/^RC_CUST_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderCustomize(ctx, chatIdStr, userId, idx);
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

    // Set start hour
    bot.action(/^RC_TIME_H_(\d+)_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const hour = Number(ctx.match[2]); const chatIdStr = ctx.match[3]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "start_time")]: { h: hour, m: 0 } } }
        );
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
        // ask number
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
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "pin")]: !it.pin } }
        );
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_LASTDEL_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [itemPath(chatIdStr, idx, "delete_last")]: !it.delete_last } }
        );
        await renderItemOverview(ctx, chatIdStr, userId, idx);
    });

    // Customize — Text
    bot.action(/^RC_SET_TEXT_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_text", chatIdStr, idx } };
        await safeEditOrSend(ctx, "👉 Send now the message you want to set.\nYou can send it already formatted or use HTML.", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("🚫 Remove message", `RC_TEXT_REMOVE_${idx}_${chatIdStr}`)], [Markup.button.callback("❌ Cancel", `RC_CUST_${idx}_${chatIdStr}`)]] }
        });
    });
    bot.action(/^RC_TEXT_REMOVE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "text")]: "" } });
        await renderCustomize(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_SEE_TEXT_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const text = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.text || "—";
        await safeEditOrSend(ctx, `Current text:\n\n<code>${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_CUST_${idx}_${chatIdStr}`)]] } });
    });

    // Customize — Media
    bot.action(/^RC_SET_MEDIA_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_media", chatIdStr, idx } };
        await safeEditOrSend(ctx, "👉 Send now the media (photo, video, sticker, document...) you want to set.\nYou can also enter a caption.", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("🚫 Remove message", `RC_MEDIA_REMOVE_${idx}_${chatIdStr}`)], [Markup.button.callback("❌ Cancel", `RC_CUST_${idx}_${chatIdStr}`)]] }
        });
    });
    bot.action(/^RC_MEDIA_REMOVE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "media")]: { type: null, file_id: null, caption: "" } } });
        await renderCustomize(ctx, chatIdStr, userId, idx);
    });
    bot.action(/^RC_SEE_MEDIA_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const m = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.media;
        const info = m?.type ? `Type: ${m.type}\nFile: <code>${m.file_id}</code>\nCaption: ${m.caption || "—"}` : "—";
        await safeEditOrSend(ctx, `Current media:\n\n${info}`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_CUST_${idx}_${chatIdStr}`)]] } });
    });

    // Customize — URL Buttons
    bot.action(/^RC_SET_BTNS_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_btns", chatIdStr, idx } };
        await safeEditOrSend(ctx, "Send buttons in syntax:\nText - https://example.com\nText2 - https://example.org\n\nMultiple lines create rows.", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_CUST_${idx}_${chatIdStr}`)]] }
        });
    });
    bot.action(/^RC_SEE_BTNS_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const btns = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx]?.url_buttons || [];
        const info = btns.length ? JSON.stringify(btns) : "—";
        await safeEditOrSend(ctx, `Current URL buttons:\n\n<code>${info.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_CUST_${idx}_${chatIdStr}`)]] } });
    });

    // Topic placeholder
    bot.action(/^RC_TOPIC_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await safeEditOrSend(ctx, "Topic selection coming soon.", { reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `RC_CUST_${idx}_${chatIdStr}`)]] } });
    });

    // Days of week toggle grid
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
        await bot.telegram.answerCbQuery(ctx.update.callback_query.id).catch(() => { });
        await bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.callbackQuery.message.message_id, undefined, undefined).catch(() => { });
        await ctx.answerCbQuery().catch(() => { });
        await ctx.match && ctx.match[0]; // no-op
        await (async () => { const fake = { ...ctx }; await bot.handleUpdate(ctx.update); })();
        await bot.actionHandlers; // no-op, to satisfy lints
        await ctx.scene && ctx.scene.state; // no-op
        await ctx.deleteMessage; // no-op
        await ctx; // no-op
        // Re-render DOW menu
        await bot.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, undefined, ""); // best-effort clear
        await ctx.answerCbQuery().catch(() => { });
        await (async () => { await renderItemOverview(ctx, chatIdStr, userId, idx); })();
    });

    // Days of month picker
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

    // Slot, dates (collect via text)
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
        await safeEditOrSend(ctx, "Send start date in YYYY-MM-DD.", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
    });
    bot.action(/^RC_EDATE_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "rc_edate", chatIdStr, idx } };
        await safeEditOrSend(ctx, "Send end date in YYYY-MM-DD.", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
    });

    // Repetition per messages and other text inputs + media capture
    bot.on("text", async (ctx, next) => {
        const st = ctx.session?.await; if (!st) return next && next();
        const { mode, chatIdStr, idx } = st;
        const userId = ctx.from.id;
        if (!chatIdStr) return next && next();

        if (mode === "rc_text") {
            await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "text")]: ctx.message.text } });
            ctx.session = {};
            return renderCustomize(ctx, chatIdStr, userId, idx);
        }
        if (mode === "rc_btns") {
            const parsed = parseButtonsSyntax(ctx.message.text || "");
            await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "url_buttons")]: parsed || [] } });
            ctx.session = {};
            return renderCustomize(ctx, chatIdStr, userId, idx);
        }
        if (mode === "rc_permsg") {
            const n = Math.max(1, Math.min(100000, parseInt(ctx.message.text, 10) || 0));
            await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "repetition.per_messages")]: n, [itemPath(chatIdStr, idx, "repetition.hours")]: 0, [itemPath(chatIdStr, idx, "repetition.minutes")]: 0 } });
            ctx.session = {};
            return renderItemOverview(ctx, chatIdStr, userId, idx);
        }
        if (mode === "rc_slot") {
            const phase = st.phase;
            const val = Math.max(0, Math.min(23, parseInt(ctx.message.text, 10) || 0));
            if (phase === "from") {
                ctx.session.await = { mode: "rc_slot", chatIdStr, idx, phase: "to", from: val };
                return safeEditOrSend(ctx, `FROM: ${val}\nNow send slot TO hour (0-23).`, { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
            } else {
                const from = st.from;
                await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "slot")]: { from, to: val } } });
                ctx.session = {};
                return renderItemOverview(ctx, chatIdStr, userId, idx);
            }
        }
        if (mode === "rc_sdate" || mode === "rc_edate") {
            const d = new Date(ctx.message.text); const valid = !isNaN(d.valueOf());
            if (valid) {
                await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, mode === "rc_sdate" ? "start_date" : "end_date")]: d.toISOString() } });
                ctx.session = {};
                return renderItemOverview(ctx, chatIdStr, userId, idx);
            } else {
                return safeEditOrSend(ctx, "Invalid date. Send YYYY-MM-DD.", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_OPEN_${idx}_${chatIdStr}`)]] } });
            }
        }

        return next && next();
    });

    // Media capture
    bot.on(["photo", "video", "document", "sticker"], async (ctx, next) => {
        const st = ctx.session?.await; if (!st || st.mode !== "rc_media") return next && next();
        const { chatIdStr, idx } = st; const userId = ctx.from.id;
        let type = null, file_id = null;
        if (ctx.message.photo) { type = "photo"; file_id = ctx.message.photo.at(-1).file_id; }
        else if (ctx.message.video) { type = "video"; file_id = ctx.message.video.file_id; }
        else if (ctx.message.document) { type = "document"; file_id = ctx.message.document.file_id; }
        else if (ctx.message.sticker) { type = "sticker"; file_id = ctx.message.sticker.file_id; }
        const caption = ctx.message.caption || "";
        if (type && file_id) {
            await user_setting_module.updateOne({ user_id: userId }, { $set: { [itemPath(chatIdStr, idx, "media")]: { type, file_id, caption } } });
            ctx.session = {};
            return renderCustomize(ctx, chatIdStr, userId, idx);
        }
        return safeEditOrSend(ctx, "Unsupported media. Send photo/video/document/sticker.", { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `RC_CUST_${idx}_${chatIdStr}`)]] } });
    });

    // Preview
    bot.action(/^RC_PREVIEW_(\d+)_(-?\d+)$/, async (ctx) => {
        const idx = Number(ctx.match[1]); const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const it = doc?.settings?.[chatIdStr]?.recurring?.items?.[idx] || {};
        const btnRows = (it.url_buttons || []).map(row => row.map(b => Markup.button.url(b.text, b.url)));
        const keyboard = btnRows.length ? { inline_keyboard: btnRows } : undefined;
        // Try to preview media if present, else text
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
};
