const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// Helpers
const minsTo = m => ({ ms: m * 60 * 1000, str: `${m} minute${m === 1 ? "" : "s"}` });

function getDel(doc, chatIdStr) {
    return doc?.settings?.[chatIdStr]?.delete_settings || {};
}
async function setPath(userId, chatIdStr, path, value) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.delete_settings.${path}`]: value } },
        { upsert: true }
    );
}
function currentMinutesOr(v, fallback = 10) {
    return typeof v?.time_ms === "number" ? Math.max(0, Math.round(v.time_ms / 60000)) : fallback;
}

// MAIN MENU
async function renderDeleteMenu(ctx, chatIdStr, isOwner) {
    ctx.session = {};
    const text =
        `🗑️ <b>Delete messages</b>\n\n` +
        `Choose what you want to configure` +
        `• <b>Global Silence</b>: Delete every message instantly when enabled.\n` +
        `• <b>Edit Checks</b>: Configure old edit deletions and suggestion message.\n` +
        `• <b>Service Messages</b>: Service/system events (join, exit, new title/photo, pin, topics, boost, video invites, checklist) will be auto-deleted after the minutes you set for each service (0 means immediately).\n` +
        `• <b>Scheduled Deletion</b>: Bot-sent messages (Welcome, Goodbye, Regulation, Personal Commands, Punishments, Manual punishments) will be auto-deleted after the time you set per category.\n` +
        `• <b>Messages self-destruction</b>: All normal messages will be auto-deleted after the delay you select when this feature is enabled.\n\n` +
        `<i>👉 Use the buttons below to control this setting for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`;

    const rows = [
        [Markup.button.callback("✍️ Edit Checks", `DELETE_MSG_SETTING_EDIT_MENU_${chatIdStr}`)],
        [Markup.button.callback("🔔 Service Messages", `DELETE_MSG_SETTING_SERVICE_MENU_${chatIdStr}`)],
        [Markup.button.callback("🗓 Scheduled Deletion", `DELETE_MSG_SETTING_SCHEDULED_MENU_${chatIdStr}`)],
        [Markup.button.callback("⏱ Self-destruction", `DELETE_MSG_SETTING_SELF_MENU_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

/* ============================
   EDIT CHECKS — SPLIT FLOW
   ============================ */

async function renderEditChooser(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const e = getDel(doc, chatIdStr).edit_checks || {};
    const statusLine = `• <b>Old messages</b>: ${e.enabled ? "On ✅" : "Off ❌"} (${(e.time_str === '0 minutes' ? "Immediately" : e.time_str) || "Immediately"})\n• <b>Edit suggestion</b>: ${e.edit_suggestion ? "On ✅" : "Off ❌"}`;

    const text =
        `🛠️ <b>Edit checks</b>\n\n` +
        `Choose what you want to configure:\n` +
        `• <b>Old messages modification</b>: Delete a message if it was edited after the allowed duration.\n` +
        `• <b>Edit suggestion</b>: Sends an advice message to the person who sends a new message to correct the previous one instead of editing it.\n\n` +
        `${statusLine}`;

    const rows = [
        [Markup.button.callback("✏️ Old Messages Modification", `DELETE_MSG_SETTING_EDIT_OLD_MENU_${chatIdStr}`)],
        [Markup.button.callback("✍️ Edit suggestion", `DELETE_MSG_SETTING_EDIT_SUGG_MENU_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_DELETING_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderEditOldMenu(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const e = getDel(doc, chatIdStr).edit_checks || {};
    const on = e.enabled;
    const cur = (e.time_str === '0 minutes' ? "Immediately" : e.time_str) || "Immediately";

    const text =
        `✏️ <b>Old messages modification</b>\n\n` +
        `When Activated, if a user edits a message after the configured time duration, that edited message will be deleted automatically.\n\n` +
        `<b>Status</b>: ${on ? "✅ Activated" : "❌ Deactivated"}\n` +
        `<b>Current Duration</b>: ${cur}`;

    const rows = [
        [Markup.button.callback("✅ Turn on", `DELETE_MSG_SETTING_EDIT_SET_on_${chatIdStr}`), Markup.button.callback("❌ Turn off", `DELETE_MSG_SETTING_EDIT_SET_off_${chatIdStr}`)],
        [Markup.button.callback("⏱ Set Duration", `DELETE_MSG_SETTING_EDIT_WINDOW_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_EDIT_MENU_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderEditWindow(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const e = getDel(doc, chatIdStr).edit_checks || {};

    const cur = (e.time_str === '0 minutes' ? "Immediately" : e.time_str) || "Immediately";
    const text =
        `⏱ <b>Set Duration\n</b>\n` +
        `Choose how many minutes after sending an edit is allowed; edits message after this time will be deleted.\n\n` +
        `<b>Current Duration</b>: ${cur}\n\n` +
        `Choose minutes (1–50) which you went to set in duration:`;

    const rows = [];
    for (let i = 1; i <= 50; i += 5) {
        const r = [];
        for (let j = i; j < i + 5 && j <= 50; j++) {
            r.push(Markup.button.callback(`${j}`, `DELETE_MSG_SETTING_EDIT_SET_${j}_${chatIdStr}`));
        }
        rows.push(r);
    }

    // New quick-action button to set to 0 minutes (delete immediately)
    rows.push([Markup.button.callback("🗑 Delete Immediately", `DELETE_MSG_SETTING_EDIT_SET_0_${chatIdStr}`)]);

    // Keep Back as the final row
    rows.push([Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_EDIT_OLD_MENU_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderEditSuggestionMenu(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const e = getDel(doc, chatIdStr).edit_checks || {};
    const on = e.edit_suggestion;

    const text =
        `✍️ <b>Edit suggestion\n</b>\n` +
        `When Activated, Sends an advice message to the person who sends a new message to correct the previous one instead of editing it.\n\n` +
        `<b>Status</b>: ${on ? "✅ Activated" : "❌ Deactivated"}`;

    const rows = [
        [Markup.button.callback("✅ Turn on", `DELETE_MSG_SETTING_EDIT_SUGG_SET_on_${chatIdStr}`), Markup.button.callback("❌ Turn off", `DELETE_MSG_SETTING_EDIT_SUGG_SET_off_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_EDIT_MENU_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// SERVICE MESSAGES
const SERVICE_MAP = {
    join: "Join",
    exit: "Exit",
    new_photo: "New Photo",
    new_title: "New Title",
    pinned: "Pinned messages",
    topics: "Topics",
    boost: "Boost",
    video_invites: "Video Chats invites",
    checklist: "Checklist"
};

async function renderServiceMenu(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const s = getDel(doc, chatIdStr).service_messages || {};
    const mins = k => typeof s[k]?.time_ms === "number" ? Math.round(s[k].time_ms / 60000) : 10;
    const line = k => `• ${SERVICE_MAP[k]}: ${s[k]?.enabled ? `On ✅ + ${(mins(k) == '0' ? "Immediately" : mins(k) + " minutes") || "Immediately"}` : "Off ❌"}`;

    const text =
        `🔔 <b>Service Messages</b>\n\n` +
        `Configure auto delete duration for service messages. from this setting service messages auto delete after that duration that configure by you.\n\n` +
        `<b>Status:</b>\n${Object.keys(SERVICE_MAP).map(line).join("\n")}\n\n` +
        `<i>Select a service to configure:</i>`;

    const rows = [
        [Markup.button.callback("Join", `DELETE_MSG_SETTING_SRV_PICK_join_${chatIdStr}`), Markup.button.callback("Exit", `DELETE_MSG_SETTING_SRV_PICK_exit_${chatIdStr}`)],
        [Markup.button.callback("New Photo", `DELETE_MSG_SETTING_SRV_PICK_new_photo_${chatIdStr}`), Markup.button.callback("New Title", `DELETE_MSG_SETTING_SRV_PICK_new_title_${chatIdStr}`)],
        [Markup.button.callback("Pinned", `DELETE_MSG_SETTING_SRV_PICK_pinned_${chatIdStr}`), Markup.button.callback("Topics", `DELETE_MSG_SETTING_SRV_PICK_topics_${chatIdStr}`)],
        [Markup.button.callback("Boost", `DELETE_MSG_SETTING_SRV_PICK_boost_${chatIdStr}`), Markup.button.callback("Video invites", `DELETE_MSG_SETTING_SRV_PICK_video_invites_${chatIdStr}`)],
        [Markup.button.callback("Checklist", `DELETE_MSG_SETTING_SRV_PICK_checklist_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_DELETING_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Service picker: row1 on/off, row2 Set time, row3 Back
async function renderServicePicker(ctx, chatIdStr, userId, key) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const v = (getDel(doc, chatIdStr).service_messages || {})[key] || {};
    const isOn = v.enabled === true;
    const curMin = currentMinutesOr(v, 0);

    const text =
        `🔧 <b>${SERVICE_MAP[key]}</b>\n
When Activated, this service message will be auto-deleted after the selected Duration.

<b>Status</b>: ${isOn ? "✅ Activated" : "❌ Deactivated"}
<b>Current Duration</b>:` + (curMin == '0' ? " Immediately" : ` ${curMin} minutes`) || "Immediately";

    const onOffRow = [
        Markup.button.callback("✅ Turn on", `DELETE_MSG_SETTING_SRV_TOGGLE_ON_${key}_${chatIdStr}`),
        Markup.button.callback("❌ Turn off", `DELETE_MSG_SETTING_SRV_TOGGLE_OFF_${key}_${chatIdStr}`)
    ];
    const setTimeRow = [Markup.button.callback("⏱ Set Duration", `DELETE_MSG_SETTING_SRV_TIME_${key}_${chatIdStr}`)];
    const backRow = [Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_SERVICE_MENU_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [onOffRow, setTimeRow, backRow] }
    });
}

// Service minutes grid
async function renderServiceTimeGrid(ctx, chatIdStr, userId, key) {
    const label = SERVICE_MAP[key];
    const text = `⏱ <b>Set Duration</b>
    
Choose how many minutes after sending service message (${label}) will be deleted.

<b>Current Duration</b>: ${currentMinutesOr((getDel(await user_setting_module.findOne({ user_id: userId }).lean(), chatIdStr).service_messages || {})[key], 0) == '0' ? " Immediately" : ` ${currentMinutesOr((getDel(await user_setting_module.findOne({ user_id: userId }).lean(), chatIdStr).service_messages || {})[key], 0)} minutes`}

Choose minutes (1–50) which you went to set in duration:`;

    const rows = [];
    // Start at 1; 5 buttons per row; go up to 50
    for (let i = 1; i <= 50; i += 5) {
        const r = [];
        for (let j = i; j < i + 5 && j <= 50; j++) {
            r.push(Markup.button.callback(`${j}`, `DELETE_MSG_SETTING_SRV_SET_${key}_${j}_${chatIdStr}`));
        }
        rows.push(r);
    }

    // Quick-action: delete immediately (0 minutes)
    rows.push([Markup.button.callback("🗑 Delete Immediately", `DELETE_MSG_SETTING_SRV_SET_${key}_0_${chatIdStr}`)]);

    // Back row
    rows.push([Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_SRV_PICK_${key}_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// SCHEDULED DELETION
const SCHED_MAP = {
    welcome: "Welcome",
    goodbye: "Goodbye",
    regulation: "Regulation",
    personal_commands: "Personal Commands",
    punishments: "Punishments",
    manual_punishments: "Manual punishments"
};

async function renderScheduledMenu(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const sc = getDel(doc, chatIdStr).scheduled || {};
    const mins = k => typeof sc[k]?.time_ms === "number" ? Math.round(sc[k].time_ms / 60000) : 10;
    const lines = Object.keys(SCHED_MAP).map(k => `• ${SCHED_MAP[k]}: ${sc[k]?.enabled ? `On ✅ + ${(mins(k) == '0' ? "Immediately" : mins(k) + " minutes") || "Immediately"}` : "Off ❌"}`).join("\n");

    const text =
        `🗓 <b>Scheduled Deletion</b>\n\n` +
        `Select which categories should be deleted after a specific time since they were sent.\n\n` +
        `<b>Status:</b>\n${lines}\n\n` +
        `<i>Select a category to configure:</i>`;

    const rows = [
        [Markup.button.callback("Welcome", `DELETE_MSG_SETTING_SCH_PICK_welcome_${chatIdStr}`), Markup.button.callback("Goodbye", `DELETE_MSG_SETTING_SCH_PICK_goodbye_${chatIdStr}`)],
        [Markup.button.callback("Regulation", `DELETE_MSG_SETTING_SCH_PICK_regulation_${chatIdStr}`)],
        [Markup.button.callback("Personal Commands", `DELETE_MSG_SETTING_SCH_PICK_personal_commands_${chatIdStr}`)],
        [Markup.button.callback("Punishments", `DELETE_MSG_SETTING_SCH_PICK_punishments_${chatIdStr}`)],
        [Markup.button.callback("Manual punishments", `DELETE_MSG_SETTING_SCH_PICK_manual_punishments_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_DELETING_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Scheduled picker: row1 on/off, row2 Set time, row3 Back
async function renderScheduledPicker(ctx, chatIdStr, userId, key) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const v = (getDel(doc, chatIdStr).scheduled || {})[key] || {};
    const isOn = v.enabled === true;
    const cur = typeof v.time_ms === "number" ? Math.round(v.time_ms / 60000) : 0;

    const text =
        `🗓 <b>${SCHED_MAP[key]}</b>

When Activated, bot-sent messages in this category will be auto-deleted after the selected Duration.

<b>Status</b>: ${isOn ? "✅ Activated" : "❌ Deactivated"}
<b>Current Duration</b>:` + (cur == '0' ? " Immediately" : ` ${cur} minutes`) || "Immediately";

    const onOffRow = [
        Markup.button.callback("✅ Turn on", `DELETE_MSG_SETTING_SCH_TOGGLE_ON_${key}_${chatIdStr}`),
        Markup.button.callback("❌ Turn off", `DELETE_MSG_SETTING_SCH_TOGGLE_OFF_${key}_${chatIdStr}`)
    ];
    const setTimeRow = [Markup.button.callback("⏱ Set Duration", `DELETE_MSG_SETTING_SCH_TIME_${key}_${chatIdStr}`)];
    const backRow = [Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_SCHEDULED_MENU_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [onOffRow, setTimeRow, backRow] }
    });
}

// Scheduled minutes grid
async function renderScheduledTimeGrid(ctx, chatIdStr, userId, key) {
    const label = SCHED_MAP[key];
    const text = `⏱ <b>Set Duration</b>
    
Choose how many minutes after sending auto-deleted message (${label}) will be deleted.

<b>Current Duration</b>: ${currentMinutesOr((getDel(await user_setting_module.findOne({ user_id: userId }).lean(), chatIdStr).scheduled || {})[key], 0) == '0' ? " Immediately" : ` ${currentMinutesOr((getDel(await user_setting_module.findOne({ user_id: userId }).lean(), chatIdStr).scheduled || {})[key], 0)} minutes`}

Choose minutes (1–50) which you went to set in duration:`;

    const rows = [];
    // 1..50, 5 buttons per row
    for (let i = 1; i <= 50; i += 5) {
        const r = [];
        for (let j = i; j < i + 5 && j <= 50; j++) {
            r.push(Markup.button.callback(`${j}`, `DELETE_MSG_SETTING_SCH_SET_${key}_${j}_${chatIdStr}`));
        }
        rows.push(r);
    }

    // Quick-action: delete immediately (0 minutes)
    rows.push([Markup.button.callback("🗑 Delete Immediately", `DELETE_MSG_SETTING_SCH_SET_${key}_0_${chatIdStr}`)]);

    // Back row
    rows.push([Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_SCH_PICK_${key}_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// SELF-DESTRUCTION — compact menu like Service/Scheduled
async function renderSelfMenu(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const sd = getDel(doc, chatIdStr).self_destruct || {};
    const isOn = sd.enabled === true;
    const curMin = currentMinutesOr(sd, 0);

    const text =
        `⏱ <b>Messages self-destruction</b>

When enabled, all normal messages will be auto-deleted after the selected delay.

<b>Status</b>: ${isOn ? "✅ Activated" : "❌ Deactivated"}
<b>Current delay</b>:` + (curMin == '0' ? " Immediately" : ` ${curMin} minutes`) || "Immediately";

    const onOffRow = [
        Markup.button.callback("✅ Turn on", `DELETE_MSG_SETTING_SELF_TOGGLE_ON_${chatIdStr}`),
        Markup.button.callback("❌ Turn off", `DELETE_MSG_SETTING_SELF_TOGGLE_OFF_${chatIdStr}`)
    ];
    const setTimeRow = [Markup.button.callback("⏱ Set Duration", `DELETE_MSG_SETTING_SELF_TIME_${chatIdStr}`)];
    const backRow = [Markup.button.callback("⬅️ Back", `SET_DELETING_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [onOffRow, setTimeRow, backRow] }
    });
}

// Self-destruct minutes grid
async function renderSelfTimeGrid(ctx, chatIdStr, userId) {
    const text = `⏱ <b>Set Duration</b>
    
Choose how many minutes after sending any message will be deleted.

<b>Current Duration</b>: ${currentMinutesOr((getDel(await user_setting_module.findOne({ user_id: userId }).lean(), chatIdStr).self_destruct || {}), 0) == '0' ? " Immediately" : ` ${currentMinutesOr((getDel(await user_setting_module.findOne({ user_id: userId }).lean(), chatIdStr).self_destruct || {}), 0)} minutes`}

Choose minutes (1–50) which you went to set in duration:`;

    const rows = [];
    // 1..50, 5 buttons per row
    for (let i = 1; i <= 50; i += 5) {
        const r = [];
        for (let j = i; j < i + 5 && j <= 50; j++) {
            r.push(Markup.button.callback(`${j}`, `DELETE_MSG_SETTING_SELF_SET_${j}_${chatIdStr}`));
        }
        rows.push(r);
    }

    // Quick-action: delete immediately (0 minutes)
    rows.push([Markup.button.callback("🗑 Delete Immediately", `DELETE_MSG_SETTING_SELF_SET_0_${chatIdStr}`)]);

    // Back row
    rows.push([Markup.button.callback("⬅️ Back", `DELETE_MSG_SETTING_SELF_MENU_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

module.exports = (bot) => {
    // Entry
    bot.action(/^SET_DELETING_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderDeleteMenu(ctx, chatIdStr, ok);
    });

    // Edit Checks chooser
    bot.action(/^DELETE_MSG_SETTING_EDIT_MENU_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderEditChooser(ctx, chatIdStr, userId);
    });

    // Old messages modification
    bot.action(/^DELETE_MSG_SETTING_EDIT_OLD_MENU_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderEditOldMenu(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_EDIT_SET_(on|off)_(-?\d+)$/, async (ctx) => {
        const toOn = ctx.match[1] === "on";
        const chatIdStr = ctx.match[2], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await setPath(userId, chatIdStr, "edit_checks.enabled", toOn);
        if (toOn) {
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const e = doc?.settings?.[chatIdStr]?.delete_settings?.edit_checks || {};
            const hasMs = typeof e.time_ms === "number" && Number.isFinite(e.time_ms) && e.time_ms > 0;
            const hasStr = typeof e.time_str === "string" && e.time_str.trim().length > 0;
            if (!hasMs || !hasStr) {
                await setPath(userId, chatIdStr, "edit_checks.time_ms", 0);
                await setPath(userId, chatIdStr, "edit_checks.time_str", "Immediately");
            }
        }
        try { await ctx.answerCbQuery(toOn ? "Old messages modification ON" : "Old messages modification OFF"); } catch { }
        await renderEditOldMenu(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_EDIT_WINDOW_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderEditWindow(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_EDIT_SET_(\d+)_(-?\d+)$/, async (ctx) => {
        const mins = Number(ctx.match[1]), chatIdStr = ctx.match[2], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const t = minsTo(mins);
        await setPath(userId, chatIdStr, "edit_checks.time_ms", t.ms);
        await setPath(userId, chatIdStr, "edit_checks.time_str", t.str);
        try { await ctx.answerCbQuery(`Set Duration: ${t.str === '0 minutes' ? "Immediately" : t.str}`); } catch { }
        await renderEditOldMenu(ctx, chatIdStr, userId);
    });

    // Edit suggestion
    bot.action(/^DELETE_MSG_SETTING_EDIT_SUGG_MENU_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderEditSuggestionMenu(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_EDIT_SUGG_SET_(on|off)_(-?\d+)$/, async (ctx) => {
        const toOn = ctx.match[1] === "on";
        const chatIdStr = ctx.match[2], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await setPath(userId, chatIdStr, "edit_checks.edit_suggestion", toOn);
        try { await ctx.answerCbQuery(toOn ? "Edit suggestion ON" : "Edit suggestion OFF"); } catch { }
        await renderEditSuggestionMenu(ctx, chatIdStr, userId);
    });

    // Service menus & routes
    bot.action(/^DELETE_MSG_SETTING_SERVICE_MENU_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderServiceMenu(ctx, chatIdStr, userId);
    });
    Object.keys(SERVICE_MAP).forEach(key => {
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SRV_PICK_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await renderServicePicker(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SRV_TOGGLE_ON_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await setPath(userId, chatIdStr, `service_messages.${key}.enabled`, true);
            try { await ctx.answerCbQuery("Enabled"); } catch { }
            await renderServicePicker(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SRV_TOGGLE_OFF_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await setPath(userId, chatIdStr, `service_messages.${key}.enabled`, false);
            try { await ctx.answerCbQuery("Disabled"); } catch { }
            await renderServicePicker(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SRV_TIME_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await renderServiceTimeGrid(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SRV_SET_${key}_(\\d+)_(-?\\d+)$`), async (ctx) => {
            const mins = Number(ctx.match[1]), chatIdStr = ctx.match[2], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const { ms, str } = minsTo(mins);
            await setPath(userId, chatIdStr, `service_messages.${key}.time_ms`, ms);
            await setPath(userId, chatIdStr, `service_messages.${key}.time_str`, ms === 0 ? "Immediately" : str);
            try { await ctx.answerCbQuery(`Set Duration (${SERVICE_MAP[key]}): ${str === '0 minutes' ? "Immediately" : str}`); } catch { }
            await renderServicePicker(ctx, chatIdStr, userId, key);
        });
    });

    // Scheduled Deletion
    bot.action(/^DELETE_MSG_SETTING_SCHEDULED_MENU_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderScheduledMenu(ctx, chatIdStr, userId);
    });
    Object.keys(SCHED_MAP).forEach(key => {
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SCH_PICK_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await renderScheduledPicker(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SCH_TOGGLE_ON_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await setPath(userId, chatIdStr, `scheduled.${key}.enabled`, true);
            try { await ctx.answerCbQuery("Enabled"); } catch { }
            await renderScheduledPicker(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SCH_TOGGLE_OFF_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await setPath(userId, chatIdStr, `scheduled.${key}.enabled`, false);
            try { await ctx.answerCbQuery("Disabled"); } catch { }
            await renderScheduledPicker(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SCH_TIME_${key}_(-?\\d+)$`), async (ctx) => {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await renderScheduledTimeGrid(ctx, chatIdStr, userId, key);
        });
        bot.action(new RegExp(`^DELETE_MSG_SETTING_SCH_SET_${key}_(\\d+)_(-?\\d+)$`), async (ctx) => {
            const mins = Number(ctx.match[1]), chatIdStr = ctx.match[2], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const { ms, str } = minsTo(mins);
            await setPath(userId, chatIdStr, `scheduled.${key}.time_ms`, ms);
            await setPath(userId, chatIdStr, `scheduled.${key}.time_str`, ms === 0 ? "Immediately" : str);
            try { await ctx.answerCbQuery(`Set Duration (${SCHED_MAP[key]}): ${str === '0 minutes' ? "Immediately" : str}`); } catch { }
            await renderScheduledPicker(ctx, chatIdStr, userId, key);
        });
    });

    // Self-destruction
    bot.action(/^DELETE_MSG_SETTING_SELF_MENU_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderSelfMenu(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_SELF_TOGGLE_ON_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await setPath(userId, chatIdStr, "self_destruct.enabled", true);
        try { await ctx.answerCbQuery("Self-destruction ON"); } catch { }
        await renderSelfMenu(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_SELF_TOGGLE_OFF_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await setPath(userId, chatIdStr, "self_destruct.enabled", false);
        try { await ctx.answerCbQuery("Self-destruction OFF"); } catch { }
        await renderSelfMenu(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_SELF_TIME_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderSelfTimeGrid(ctx, chatIdStr, userId);
    });
    bot.action(/^DELETE_MSG_SETTING_SELF_SET_(\d+)_(-?\d+)$/, async (ctx) => {
        const mins = Number(ctx.match[1]), chatIdStr = ctx.match[2], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const { ms, str } = minsTo(mins);
        await setPath(userId, chatIdStr, "self_destruct.time_ms", ms);
        await setPath(userId, chatIdStr, "self_destruct.time_str", ms === 0 ? "Immediately" : str);
        try { await ctx.answerCbQuery(`Self-destruction: ${str === '0 minutes' ? "Immediately" : str}`); } catch { }
        await renderSelfMenu(ctx, chatIdStr, userId);
    });
};
