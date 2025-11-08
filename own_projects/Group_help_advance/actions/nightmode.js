const { Markup } = require("telegraf");
const moment = require("moment-timezone");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// Helpers
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Default auto slot when enabling a mode without prior slot
const DEFAULT_SLOT = { start_hour: 23, end_hour: 9 };

// Read current night config
function getNight(doc, chatIdStr) {
    return doc?.settings?.[chatIdStr]?.night || {};
}

// Read chat time zone name stored separately: settings.<chatId>.time_zone.tz_name
function getChatTZName(doc, chatIdStr) {
    return doc?.settings?.[chatIdStr]?.time_zone?.tz_name || "";
}

// Persist partial update
async function setNight(userId, chatIdStr, partial) {
    const setOps = {};
    for (const [k, v] of Object.entries(partial)) {
        setOps[`settings.${chatIdStr}.night.${k}`] = v;
    }
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set: setOps },
        { upsert: true }
    );
}

// Build status line
function buildStatus(night) {
    const mode = (night.mode || "off");
    if (mode === "off") return { title: "Status: ❌ Off", detail: "" };
    const action = mode === "delete" ? "🖼️ Delete medias" : "🤐 Global Silence";
    const start = Number.isInteger(night.start_hour) ? night.start_hour : DEFAULT_SLOT.start_hour;
    const end = Number.isInteger(night.end_hour) ? night.end_hour : DEFAULT_SLOT.end_hour;
    const advise = night.advise ? "On ✅" : "Off ❌";
    return {
        title: `<b>Status</b>: ${action}`,
        detail: `└ Active from hour ${start} to ${end}\n└ Start&End advises: ${advise}`
    };
}

// Format "Current time" for a given tzName (IANA or "GMT±HH:MM"), else server time
function formatNowForTZ(tzName) {
    if (tzName && moment.tz.zone(tzName)) {
        return moment().tz(tzName).format("DD/MM/YY HH:mm");
    }
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzName || "");
    if (m) {
        const sign = m[1] === "-" ? -1 : 1;
        const hh = parseInt(m[2], 10);
        const mm = parseInt(m[3], 10);
        return moment().utcOffset(sign * (hh * 60 + mm)).format("DD/MM/YY HH:mm");
    }
    // Fallback: server time
    return moment().format("DD/MM/YY HH:mm");
}

// ---------- Renderers ----------
async function renderNightMain(ctx, chatIdStr, userId, isOwner) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const night = getNight(doc, chatIdStr);

    const { title, detail } = buildStatus(night);
    const tzName = getChatTZName(doc, chatIdStr);
    const nowStr = `<b>Current time</b>: ${formatNowForTZ(tzName)}`;
    const tzLine = tzName ? `\n<b>Time zone</b>: ${esc(tzName)}` : `Time zone: Not set`;
    const isOff = (night.mode || "off") === "off";

    const text =
        `🌙 <b>Night mode</b>\n\n` +
        `Select the actions you want to limit every night.\n\n` +
        `${title}\n${detail ? detail + "\n" : ""}` +
        `${tzLine}\n${nowStr}` +
        `\n\n<i>👉 Use the buttons below to control this setting for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`;

    const rows = [];

    // Primary state buttons always shown
    rows.push([Markup.button.callback("❌ Off", `NIGHT_SET_OFF_${chatIdStr}`)]);
    rows.push([
        Markup.button.callback("🖼️ Delete medias", `NIGHT_SET_DELETE_${chatIdStr}`),
        Markup.button.callback("🤐 Global Silence", `NIGHT_SET_SILENCE_${chatIdStr}`)
    ]);

    // Hide the following when status is Off
    if (!isOff) {
        rows.push([Markup.button.callback("🕒 Set time slot", `NIGHT_SLOT_OPEN_${chatIdStr}`)]);
        rows.push([Markup.button.callback(`🔔 Start&End advises ${night.advise ? "✅" : "❌"}`, `NIGHT_TOGGLE_ADVISE_${chatIdStr}`)]);
        rows.push([
            Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`),
            Markup.button.callback("🕰 Time Zone", `NIGHT_TZ_${chatIdStr}`)
        ]);
    } else {
        rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);
    }

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderSlotStart(ctx, chatIdStr, userId) {
    const text =
        `🌙 <b>Night mode</b>\n\n` +
        `In this menu you can set an interval of hour and every day, in that hours will be enabled the night mode.\n\n` +
        `👉 <b>Select the starting time:</b>`;

    const hours = Array.from({ length: 24 }, (_, i) => i);
    const grid = [];
    for (let i = 0; i < 24; i += 5) {
        const row = hours.slice(i, i + 5).map(h => Markup.button.callback(`${h}`, `NIGHT_SLOT_START_${h}_${chatIdStr}`));
        grid.push(row);
    }
    grid.push([Markup.button.callback("⬅️ Back", `SET_NIGHT_${chatIdStr}`)]);
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: grid } });
}

async function renderSlotEnd(ctx, chatIdStr, userId, startHour) {
    const text =
        `🌙 <b>Night mode</b>\n\n` +
        `In this menu you can set an interval of hour and every day, in that hours will be enabled the night mode.\n\n` +
        `🕰 <b>Starting time:</b> ${startHour}\n\n` +
        `👉 <b>Select the end time:</b>`;

    const choices = [];
    for (let h = startHour + 1; h <= 23; h++) choices.push(h);

    const grid = [];
    for (let i = 0; i < choices.length; i += 5) {
        const row = choices.slice(i, i + 5).map(h => Markup.button.callback(`${h}`, `NIGHT_SLOT_END_${startHour}_${h}_${chatIdStr}`));
        grid.push(row);
    }
    grid.push([Markup.button.callback("⬅️ Back", `NIGHT_SLOT_OPEN_${chatIdStr}`)]);
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: grid } });
}

// ---------- Module ----------
module.exports = (bot) => {
    // Entry from "🌙 Night" button
    bot.action(/^SET_NIGHT_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = {};
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderNightMain(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("SET_NIGHT error:", e); }
    });

    // Turn Off
    bot.action(/^NIGHT_SET_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;
            await setNight(userId, chatIdStr, { mode: "off" });
            await renderNightMain(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("NIGHT_SET_OFF error:", e); }
    });

    // Delete medias (auto slot if missing)
    bot.action(/^NIGHT_SET_DELETE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const night = getNight(doc, chatIdStr);
            const needSlot = !(Number.isInteger(night.start_hour) && Number.isInteger(night.end_hour));

            const payload = { mode: "delete" };
            if (needSlot) { payload.start_hour = DEFAULT_SLOT.start_hour; payload.end_hour = DEFAULT_SLOT.end_hour; }
            await setNight(userId, chatIdStr, payload);

            await renderNightMain(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("NIGHT_SET_DELETE error:", e); }
    });

    // Global Silence (auto slot if missing)
    bot.action(/^NIGHT_SET_SILENCE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const night = getNight(doc, chatIdStr);
            const needSlot = !(Number.isInteger(night.start_hour) && Number.isInteger(night.end_hour));

            const payload = { mode: "silence" };
            if (needSlot) { payload.start_hour = DEFAULT_SLOT.start_hour; payload.end_hour = DEFAULT_SLOT.end_hour; }
            await setNight(userId, chatIdStr, payload);

            await renderNightMain(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("NIGHT_SET_SILENCE error:", e); }
    });

    // Open time slot chooser (guard if Off)
    bot.action(/^NIGHT_SLOT_OPEN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const night = getNight(doc, chatIdStr);
            if ((night.mode || "off") === "off") {
                await ctx.answerCbQuery("Turn a mode On to set time slot.", { show_alert: true });
                return;
            }
            await renderSlotStart(ctx, chatIdStr, userId);
        } catch (e) { console.error("NIGHT_SLOT_OPEN error:", e); }
    });

    // Pick start hour
    bot.action(/^NIGHT_SLOT_START_([0-9]|1[0-9]|2[0-3])_(-?\d+)$/, async (ctx) => {
        try {
            const startHour = parseInt(ctx.match[1]);
            const chatIdStr = ctx.match[2]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;
            ctx.session = ctx.session || {};
            ctx.session.nightSlot = { chatIdStr, startHour };
            await renderSlotEnd(ctx, chatIdStr, userId, startHour);
        } catch (e) { console.error("NIGHT_SLOT_START error:", e); }
    });

    // Pick end hour (> start)
    bot.action(/^NIGHT_SLOT_END_([0-9]|1[0-9]|2[0-3])_([0-9]|1[0-9]|2[0-3])_(-?\d+)$/, async (ctx) => {
        try {
            const startHour = parseInt(ctx.match[1]);
            const endHour = parseInt(ctx.match[2]);
            const chatIdStr = ctx.match[3]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;

            if (!(endHour > startHour)) {
                await ctx.answerCbQuery("End time must be greater than start time.", { show_alert: true });
                return;
            }

            await setNight(userId, chatIdStr, { start_hour: startHour, end_hour: endHour });
            if (ctx.session?.nightSlot) delete ctx.session.nightSlot;

            await renderNightMain(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("NIGHT_SLOT_END error:", e); }
    });

    // Advise toggle (guard if Off)
    bot.action(/^NIGHT_TOGGLE_ADVISE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1]; const chatId = Number(chatIdStr); const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const night = getNight(doc, chatIdStr);
            if ((night.mode || "off") === "off") {
                await ctx.answerCbQuery("Turn a mode On to use advises.", { show_alert: true });
                return;
            }

            const newVal = !night.advise;
            await setNight(userId, chatIdStr, { advise: newVal });

            await renderNightMain(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("NIGHT_TOGGLE_ADVISE error:", e); }
    });
};
