// checks.js (Part 1/3) — Force settings with preview
const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// helpers
function getBool(obj, path, def = false) {
    try {
        const keys = path.split(".");
        let cur = obj;
        for (const k of keys) {
            if (cur == null) return def;
            cur = cur[k];
        }
        return !!cur;
    } catch {
        return def;
    }
}

function penaltyPretty(p) {
    const map = { off: "Off", advise: "Advise", warn: "Warn", kick: "Kick", mute: "Mute", ban: "Ban" };
    return map[(p || "off").toLowerCase()] || p;
}

// Media extraction for schema (media + media_type)
function extractMediaForSchema(message) {
    if (message.photo && Array.isArray(message.photo) && message.photo.length) {
        const best = message.photo[message.photo.length - 1];
        return { media: best.file_id, media_type: "photo" };
    }
    if (message.video) return { media: message.video.file_id, media_type: "video" };
    if (message.document) return { media: message.document.file_id, media_type: "document" };
    return null;
}

// Channel normalizer
function normalizeChannel(input) {
    const raw = (input || "").trim();
    if (!raw) return "";
    if (raw.startsWith("https://t.me/")) {
        const u = raw.replace("https://t.me/", "").split(/[/?#]/)[0];
        return u ? `@${u.replace(/^@+/, "")}` : raw;
    }
    if (raw.startsWith("@")) return raw;
    if (/^-100\d{5,}$/.test(raw)) return raw;
    if (/^[a-zA-Z0-9_]{5,32}$/.test(raw)) return `@${raw}`;
    return raw;
}

// ========== Main compact settings menu ==========
async function renderChecksMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const checks = userDoc?.settings?.[chatIdStr]?.checks || {};

    const force = checks.force || {};
    const nb = checks.name_blocks || {};
    const statusOn = (v) => (v ? "On" : "Off");

    const text =
        `<b>FORCE SETTINGS</b>\n` +
        `• Force channel join: <b>${statusOn(force.channel_join)}</b>\n` +
        `• Force member add: <b>${statusOn(force.member_add)}</b>\n\n` +

        `<b>PROFILE PENALTIES</b>\n` +
        `• Surname penalty: <b>${penaltyPretty(checks.profile_penalties?.surname || "off")}</b>\n` +
        `• Username penalty: <b>${penaltyPretty(checks.profile_penalties?.username || "off")}</b>\n` +
        `• Profile picture penalty: <b>${penaltyPretty(checks.profile_penalties?.profile_picture || "off")}</b>\n\n` +

        `<b>NAME BLOCKS</b>\n` +
        `• Arabic: <b>${statusOn(nb.arabic)}</b>\n` +
        `• Chinese: <b>${statusOn(nb.chinese)}</b>\n` +
        `• Russian: <b>${statusOn(nb.russian)}</b>\n` +
        `• Spam: <b>${statusOn(nb.spam)}</b>\n\n` +

        `🚪 Check at join: <b>${statusOn(checks.check_at_join)}</b>\n` +
        `If active, the bot will check for force, profile and blocks even when users joins the group, as well as when sending a message.\n\n` +
        `🗑 Delete messages: <b>${statusOn(checks.delete_messages)}</b>\n` +
        `If active, the bot will delete messages sent by users who do not comply with the force/profile/blocks.\n\n` +
        `<i>Open a section to configure details.</i>`;

    const checkAtJoin = getBool(checks, "check_at_join", false);
    const deleteMessages = getBool(checks, "delete_messages", false);

    const rows = [
        [
            Markup.button.callback("FORCE SETTINGS", `SET_FORCE_SETTINGS_${chatIdStr}`),
            Markup.button.callback("PROFILE PENALTIES", `SET_PENALTIES_${chatIdStr}`)
        ],
        [Markup.button.callback("NAME BLOCKS", `SET_NAME_BLOCKS_${chatIdStr}`)],
        [Markup.button.callback(`${checkAtJoin ? "📥 Check at the join ✓" : "📥 Check at the join ✗"}`, `TOGGLE_CHECK_JOIN_${chatIdStr}`)],
        [Markup.button.callback(`${deleteMessages ? "🗑️ Delete Messages ✓" : "🗑️ Delete Messages ✗"}`, `TOGGLE_DELETE_MESSAGES_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Force settings menu (2 items) ==========
async function renderForceSettingsMenu(ctx, chatIdStr, userId) {
    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const checks = userDoc?.settings?.[chatIdStr]?.checks || {};
    const force = checks.force || {};
    const status = (v) => (v ? "On ✅" : "Off ❌");

    const fcj = checks.force_channel_join || {};
    const chCount = Array.isArray(fcj.channels) ? fcj.channels.length : 0;
    const fma = checks.force_add_member || {};
    const minAdd = Number.isInteger(fma.add_min) ? fma.add_min : 0;

    const text =
        `🔧 <b>Force settings</b>\n\n` +
        `• Force channel join — <b>Status</b>: ${status(force.channel_join)} | <b>Channels</b>: ${chCount}\n` +
        `• Force member add — <b>Status</b>: <b>${status(force.member_add)}</b> | <b>Min</b>: <b>${minAdd}</b>\n\n` +
        `<i>Select button to config force setting for <b>${isOwner?.title}</b>.</i>`;

    const rows = [
        [
            Markup.button.callback("📣 Force channel join", `OPEN_FORCE_CHANNEL_${chatIdStr}`),
            Markup.button.callback("➕ Force member add", `OPEN_FORCE_ADD_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `SET_CHECKS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Profile penalties (surname/username/profile_picture) ==========
async function renderPenaltiesMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const pens = userDoc?.settings?.[chatIdStr]?.checks?.profile_penalties || {};

    const text =
        `⚙️ <b>Profile penalties</b>\n\n` +
        `• Surname: <b>${penaltyPretty(pens.surname || "off")}</b>\n` +
        `• Username: <b>${penaltyPretty(pens.username || "off")}</b>\n` +
        `• Profile picture: <b>${penaltyPretty(pens.profile_picture || "off")}</b>\n\n` +
        `<b>How it works</b>\n` +
        `If a member’s profile is missing any enabled requirement (surname, username, or profile picture), the selected penalty for that field will be applied automatically when checks run.\n` +
        `Checks run when the member joins (if “Check at join” is enabled) and when they send messages; if “Delete messages” is enabled, those messages will be removed.\n\n` +
        `<i>Tap a field to choose a penalty (Off, Advise, Warn, Kick, Mute, Ban).</i>`;

    const rows = [
        [Markup.button.callback("👤 Surname", `OPEN_PEN_SURNAME_${chatIdStr}`)],
        [Markup.button.callback("🌐 Username", `OPEN_PEN_USERNAME_${chatIdStr}`)],
        [Markup.button.callback("🖼️ Profile picture", `OPEN_PEN_PFP_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_CHECKS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Single penalty picker (with explanation) ==========
async function renderSinglePenaltyPicker(ctx, chatIdStr, userId, key, label) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const pens = userDoc?.settings?.[chatIdStr]?.checks?.profile_penalties || {};
    const cur = (pens[key] || "off").toLowerCase();

    const requirementLabel =
        key === "surname" ? "surname" :
            key === "username" ? "username" :
                "profile picture";

    const text =
        `${label}\n\n` +
        `Penalty: <b>${penaltyPretty(cur)}</b>\n\n` +
        `If a member’s profile is missing the required ${requirementLabel}, the selected penalty for this field will be applied automatically when checks run. Set this to <b>Off</b> to disable enforcement for this field.\n\n` +
        `<i>Select one of the options:</i>`;

    const rows = [
        [
            Markup.button.callback("❌ Off", `SET_PEN_off_${key}_${chatIdStr}`),
            Markup.button.callback("⚠ Advise", `SET_PEN_advise_${key}_${chatIdStr}`),
            Markup.button.callback("❗ Warn", `SET_PEN_warn_${key}_${chatIdStr}`)
        ],
        [
            Markup.button.callback("❕ Kick", `SET_PEN_kick_${key}_${chatIdStr}`),
            Markup.button.callback("🔇 Mute", `SET_PEN_mute_${key}_${chatIdStr}`),
            Markup.button.callback("⛔ Ban", `SET_PEN_ban_${key}_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `SET_PENALTIES_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Name Blocks ==========
async function renderNameBlocksMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const blocks = userDoc?.settings?.[chatIdStr]?.checks?.name_blocks || {};
    const statusOn = (v) => (v ? "On ✅" : "Off ❌");

    const text =
        `🚫 <b>Name Blocks</b>\n\n` +
        `• Arabic: ${statusOn(blocks.arabic)}\n` +
        `• Chinese: ${statusOn(blocks.chinese)}\n` +
        `• Russian: ${statusOn(blocks.russian)}\n` +
        `• Spam: ${statusOn(blocks.spam)}\n\n` +
        `<b>How it works</b>\n` +
        `If a member’s profile name contains characters from any enabled language, the bot will enforce the configured action for name blocks (e.g., warn/kick/mute/ban) automatically.\n` +
        `Checks run when the member joins (if “Check at join” is enabled) and when they send messages; if “Delete messages” is enabled, their messages will be removed during enforcement.\n\n` +
        `Toggle each block below:`;

    const rows = [
        [Markup.button.callback("🈶 Arabic (configure)", `OPEN_NB_PICK_arabic_${chatIdStr}`)],
        [Markup.button.callback("中 Chinese (configure)", `OPEN_NB_PICK_chinese_${chatIdStr}`)],
        [Markup.button.callback("RU Russian (configure)", `OPEN_NB_PICK_russian_${chatIdStr}`)],
        [Markup.button.callback("🚩 Spam (configure)", `OPEN_NB_PICK_spam_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_CHECKS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

function nbPenaltyPretty(p) {
    const map = { off: "Off", advise: "Advise", warn: "Warn", kick: "Kick", mute: "Mute", ban: "Ban" };
    return map[(p || "off").toLowerCase()] || p;
}

async function renderNameBlockPicker(ctx, chatIdStr, userId, langKey, langLabel) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const checks = userDoc?.settings?.[chatIdStr]?.checks || {};
    const cur = (checks.name_blocks_penalty?.[langKey] || "off").toLowerCase();

    const text =
        `🚫 <b>Name Block: ${langLabel}</b>\n\n` +
        `Action: <b>${nbPenaltyPretty(cur)}</b>\n\n` +
        `<b>How it works</b>\n` +
        `If a member’s profile name contains ${langLabel} characters and this block is not Off, the selected action will be applied automatically when checks run.\n` +
        `Checks run on join (if “Check at join” is enabled) and on messages; with “Delete messages” enabled, their messages will be removed during enforcement.\n\n` +
        `Choose an action:`;

    const rows = [
        [
            Markup.button.callback("❌ Off", `SET_NB_pen_off_${langKey}_${chatIdStr}`),
            Markup.button.callback("⚠ Advise", `SET_NB_pen_advise_${langKey}_${chatIdStr}`),
            Markup.button.callback("❗ Warn", `SET_NB_pen_warn_${langKey}_${chatIdStr}`)
        ],
        [
            Markup.button.callback("❕ Kick", `SET_NB_pen_kick_${langKey}_${chatIdStr}`),
            Markup.button.callback("🔇 Mute", `SET_NB_pen_mute_${langKey}_${chatIdStr}`),
            Markup.button.callback("⛔ Ban", `SET_NB_pen_ban_${langKey}_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `SET_NAME_BLOCKS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Force channel join detailed menu (with See buttons) ==========
async function renderForceChannelJoinMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const checks = userDoc?.settings?.[chatIdStr]?.checks || {};
    const force = checks.force || {};
    const fcj = checks.force_channel_join || {};
    const enabled = !!force.channel_join;

    const channels = Array.isArray(fcj.channels) ? fcj.channels : [];
    const list = channels.length ? channels.map((t, i) => `${i + 1}. ${t}`).join("\n") : "None";

    const textSet = !!(fcj.message && String(fcj.message).trim());
    const mediaSet = !!(fcj.media && fcj.media_type);

    const text =
        `📣 <b>Force channel join</b>\n\n` +
        `<b>Status</b>: ${enabled ? "On ✅" : "Off ❌"}\n\n` +
        `<b>Channels List</b>:\n${list}\n\n` +
        `<b>Custom prompt</b>\n` +
        `• Text: ${textSet ? "Set ✅" : "Default ❌"}\n` +
        `• Media: ${mediaSet ? `${fcj.media_type} ✅` : "None ❌"}\n\n` +
        `<i>Use the buttons below to control this setting.</i>`;

    const rows = [
        [
            Markup.button.callback("✅ Turn on", `FCJ_TURN_ON_${chatIdStr}`),
            Markup.button.callback("❌ Turn off", `FCJ_TURN_OFF_${chatIdStr}`)
        ],
        [
            Markup.button.callback("➕ Add channel", `FCJ_ADD_CH_${chatIdStr}`),
            Markup.button.callback("➖ Remove channel", `FCJ_REM_CH_${chatIdStr}`)
        ],
        [Markup.button.callback("🧹 Clear all channels", `FCJ_CLEAR_CH_${chatIdStr}`)],
        [
            Markup.button.callback("📝 Set text", `FCJ_SET_TEXT_${chatIdStr}`),
            Markup.button.callback("👀 See text", `FCJ_SEE_TEXT_${chatIdStr}`),
        ],
        [
            Markup.button.callback("🖼️ Set media", `FCJ_SET_MEDIA_${chatIdStr}`),
            Markup.button.callback("👀 See media", `FCJ_SEE_MEDIA_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `SET_FORCE_SETTINGS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Force member add detailed menu (with See buttons) ==========
async function renderForceMemberAddMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const checks = userDoc?.settings?.[chatIdStr]?.checks || {};
    const force = checks.force || {};
    const fma = checks.force_add_member || {};

    const enabled = !!force.member_add;
    const minAdd = Number.isInteger(fma.add_min) ? fma.add_min : 0;
    const textSet = !!(fma.add_message && String(fma.add_message).trim());
    const mediaSet = !!(fma.media && fma.media_type);

    const text =
        `➕ <b>Force member add</b>\n\n` +
        `<b>Status</b>: ${enabled ? "On ✅" : "Off ❌"}\n` +
        `<b>Minimum members to add</b>: ${minAdd || 0}\n` +
        `• Custom text: ${textSet ? "Set ✅" : "Default ❌"}\n` +
        `• Custom media: ${mediaSet ? `${fma.media_type} ✅` : "None ❌"}\n\n` +
        `<i>Use the buttons below to control this setting.</i>`;

    const rows = [
        [
            Markup.button.callback("✅ Turn on", `FMA_TURN_ON_${chatIdStr}`),
            Markup.button.callback("❌ Turn off", `FMA_TURN_OFF_${chatIdStr}`)
        ],
        [
            Markup.button.callback("🔢 Set minimum", `FMA_SET_MIN_${chatIdStr}`),
        ],
        [
            Markup.button.callback("📝 Set text", `FMA_SET_TEXT_${chatIdStr}`),
            Markup.button.callback("👀 See text", `FMA_SEE_TEXT_${chatIdStr}`)
        ],
        [
            Markup.button.callback("🖼️ Set media", `FMA_SET_MEDIA_${chatIdStr}`),
            Markup.button.callback("👀 See media", `FMA_SEE_MEDIA_${chatIdStr}`)
        ],
        [Markup.button.callback("⬅️ Back", `SET_FORCE_SETTINGS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// ========== Exports & root handlers header (continued in Part 2/3) ==========
module.exports = (bot) => {
    // Open main checks menu
    bot.action(/^SET_CHECKS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;
            await renderChecksMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("SET_CHECKS error:", e); }
    });

    // Open sub-menus
    bot.action(/^SET_FORCE_SETTINGS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;
            await renderForceSettingsMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("SET_FORCE_SETTINGS error:", e); }
    });

    bot.action(/^SET_PENALTIES_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;
            await renderPenaltiesMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("SET_PENALTIES error:", e); }
    });

    bot.action(/^SET_NAME_BLOCKS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;
            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("SET_NAME_BLOCKS error:", e); }
    });

    // Global toggles
    bot.action(/^TOGGLE_CHECK_JOIN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!doc?.settings?.[chatIdStr]?.checks?.check_at_join;
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.check_at_join`]: !cur } },
                { upsert: true }
            );
            await ctx.answerCbQuery(`Check at join: ${!cur ? "On" : "Off"}`);
            await renderChecksMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("TOGGLE_CHECK_JOIN error:", e); }
    });

    bot.action(/^TOGGLE_DELETE_MESSAGES_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!doc?.settings?.[chatIdStr]?.checks?.delete_messages;
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.delete_messages`]: !cur } },
                { upsert: true }
            );
            await ctx.answerCbQuery(`Delete messages: ${!cur ? "On" : "Off"}`);
            await renderChecksMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("TOGGLE_DELETE_MESSAGES error:", e); }
    });

    // Penalties pickers
    bot.action(/^OPEN_PEN_SURNAME_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderSinglePenaltyPicker(ctx, chatIdStr, userId, "surname", "👤 Surname penalty");
    });
    bot.action(/^OPEN_PEN_USERNAME_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderSinglePenaltyPicker(ctx, chatIdStr, userId, "username", "🌐 Username penalty");
    });
    bot.action(/^OPEN_PEN_PFP_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1], userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderSinglePenaltyPicker(ctx, chatIdStr, userId, "profile_picture", "🖼️ Profile picture penalty");
    });

    bot.action(/^SET_PEN_(off|advise|warn|kick|mute|ban)_(surname|username|profile_picture)_(-?\d+)$/, async (ctx) => {
        try {
            const pen = ctx.match[1], key = ctx.match[2], chatIdStr = ctx.match[3], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.profile_penalties.${key}`]: pen } },
                { upsert: true }
            );
            await ctx.answerCbQuery(`Saved: ${key} -> ${penaltyPretty(pen)}`);
            await renderSinglePenaltyPicker(ctx, chatIdStr, userId, key,
                key === "surname" ? "👤 Surname penalty" :
                    key === "username" ? "🌐 Username penalty" :
                        "🖼️ Profile picture penalty"
            );
        } catch (e) { console.error("SET_PEN error:", e); }
    });

    // Open detailed “force” cards
    bot.action(/^OPEN_FORCE_CHANNEL_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("OPEN_FORCE_CHANNEL error:", e); }
    });

    bot.action(/^OPEN_FORCE_ADD_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await renderForceMemberAddMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("OPEN_FORCE_ADD error:", e); }
    });

    bot.action(/^OPEN_NB_PICK_(arabic|chinese|russian|spam)_(-?\d+)$/, async (ctx) => {
        const langKey = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

        const labelMap = { arabic: "Arabic", chinese: "Chinese", russian: "Russian", spam: "Spam" };
        await renderNameBlockPicker(ctx, chatIdStr, userId, langKey, labelMap[langKey]);
    });

    bot.action(/^SET_NB_pen_(off|advise|warn|kick|mute|ban)_(arabic|chinese|russian|spam)_(-?\d+)$/, async (ctx) => {
        try {
            const action = ctx.match[1];
            const langKey = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            // Save penalty level
            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.checks.name_blocks_penalty.${langKey}`]: action }
                },
                { upsert: true }
            );

            // Optional: keep a boolean flag in sync for visibility in the list
            // true if not "off", false if "off"
            const enabled = action !== "off";
            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.checks.name_blocks.${langKey}`]: enabled }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Saved: ${langKey} -> ${nbPenaltyPretty(action)}`);
            const labelMap = { arabic: "Arabic", chinese: "Chinese", russian: "Russian", spam: "Spam" };
            await renderNameBlockPicker(ctx, chatIdStr, userId, langKey, labelMap[langKey]);
        } catch (e) { console.error("SET_NB_pen error:", e); }
    });

    // Force channel join: On (with pre-check for channels)
    bot.action(/^FCJ_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            // Check channels array first
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const channels = doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.channels || [];

            if (!Array.isArray(channels) || channels.length === 0) {
                // Redirect to Add channel prompt instead of enabling
                const msg =
                    "🔗 <b>Add required channel</b>\n\n" +
                    "Send @username, https://t.me/username, or -1001234567890 (ID).\n" +
                    "<i>Also add this bot as admin in that channel for verification.</i>";
                const sent = await safeEditOrSend(ctx, msg, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]])
                }, true);

                ctx.session = ctx.session || {};
                ctx.session.awaitingFCJAddChannel = { chatIdStr, userId, promptMessageId: sent };
                await ctx.answerCbQuery("Add at least one channel first.");
                return;
            }

            // Enable if channels exist
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force.channel_join`]: true } },
                { upsert: true }
            );
            await ctx.answerCbQuery("Force channel join: On");
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FCJ_TURN_ON error:", e); }
    });

    bot.action(/^FCJ_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force.channel_join`]: false } },
                { upsert: true }
            );
            await ctx.answerCbQuery("Force channel join: Off");
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FCJ_TURN_OFF error:", e); }
    });

    // Force channel join: channels add/remove/clear
    bot.action(/^FCJ_ADD_CH_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const msg =
                "🔗 <b>Add channel</b>\n\n" +
                "Send <code>@username</code>, <code>https://t.me/username</code>, or <code>-1001234567890</code> (ID).\n\n" +
                "Also add this bot as an <b>Admin to that Channel</b> for verification otherwise this setting won't work.";

            const sent = await safeEditOrSend(ctx, msg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]])
            }, true);
            ctx.session = ctx.session || {};
            ctx.session.awaitingFCJAddChannel = { chatIdStr, userId, promptMessageId: sent };
            await ctx.answerCbQuery();
        } catch (e) { console.error("FCJ_ADD_CH error:", e); }
    });

    bot.action(/^FCJ_REM_CH_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const channels = doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.channels || [];
            if (!channels.length) {
                await ctx.answerCbQuery("No channels to remove.");
                await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
                return;
            }
            const rows = channels.map((c, i) => [Markup.button.callback(`Remove: ${c}`, `FCJ_REM_ONE_${i}_${chatIdStr}`)]);
            rows.push([Markup.button.callback("⬅️ Back", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]);
            await safeEditOrSend(ctx, "Select a channel to remove:", { reply_markup: { inline_keyboard: rows } });
        } catch (e) { console.error("FCJ_REM_CH error:", e); }
    });

    bot.action(/^FCJ_REM_ONE_(\d+)_(-?\d+)$/, async (ctx) => {
        try {
            const idx = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const arr = (doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.channels || []).slice();
            if (idx < 0 || idx >= arr.length) { await ctx.answerCbQuery("Invalid item."); return; }

            // Remove selected channel
            arr.splice(idx, 1);

            // If no channels left, also turn OFF Force channel join
            const update = {
                $setOnInsert: { user_id: userId },
                $set: { [`settings.${chatIdStr}.checks.force_channel_join.channels`]: arr }
            };
            if (arr.length === 0) {
                update.$set[`settings.${chatIdStr}.checks.force.channel_join`] = false;
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                update,
                { upsert: true }
            );

            await ctx.answerCbQuery(arr.length === 0 ? "Removed. No channels left; turned OFF." : "Removed.");
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FCJ_REM_ONE error:", e); }
    });

    // Clear all channels AND turn Force channel join off
    bot.action(/^FCJ_CLEAR_CH_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: {
                        [`settings.${chatIdStr}.checks.force_channel_join.channels`]: [],
                        [`settings.${chatIdStr}.checks.force.channel_join`]: false
                    }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("Cleared all channels and turned OFF Force channel join.");
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FCJ_CLEAR_CH error:", e); }
    });

    // Force channel join: text/media input screens
    bot.action(/^FCJ_SET_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;
           
            const msg =
                `📝 <b>Set force channel join prompt text</b>\n\n` +
                `Send the text shown to users who haven't joined the required channels.\n` +
                `For message design options (placeholders and HTML), <a href="${process.env.WEBPAGE_URL_GROUP_HELP_ADVANCE}/text-message-design">click here</a>.`

            const sent = await safeEditOrSend(ctx, msg, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🚫 Remove message", `FCJ_DEL_TEXT_${chatIdStr}`)],
                    [Markup.button.callback("❌ Cancel", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]
                ])
            }, true);

            ctx.session = ctx.session || {};
            ctx.session.awaitingFCJText = { chatIdStr, userId, promptMessageId: sent };
            await ctx.answerCbQuery();
        } catch (e) { console.error("FCJ_SET_TEXT error:", e); }
    });

    bot.action(/^FCJ_DEL_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.message;
            if (!current || !String(current).trim()) {
                await ctx.answerCbQuery("Nothing to delete.");
                return await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.checks.force_channel_join.message`]: "" } }
            );
            await ctx.answerCbQuery("Removed channel prompt text.");
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FCJ_DEL_TEXT error:", e); }
    });

    bot.action(/^FCJ_SET_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const msg =
                "🖼️ <b>Set force channel join prompt media</b>\n\n" +
                "Send a photo, video, or document (caption is ignored).";

            const sent = await safeEditOrSend(ctx, msg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("🚫 Remove message", `FCJ_DEL_MEDIA_${chatIdStr}`)],
                    [Markup.button.callback("❌ Cancel", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]
                ])
            }, true);
            ctx.session = ctx.session || {};
            ctx.session.awaitingFCJMedia = { chatIdStr, userId, promptMessageId: sent };
            await ctx.answerCbQuery();
        } catch (e) { console.error("FCJ_SET_MEDIA error:", e); }
    });

    bot.action(/^FCJ_DEL_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const has = !!(doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.media && doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.media_type);
            if (!has) {
                await ctx.answerCbQuery("Nothing to delete.");
                return await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.checks.force_channel_join.media`]: "", [`settings.${chatIdStr}.checks.force_channel_join.media_type`]: "" } }
            );
            await ctx.answerCbQuery("Removed channel prompt media.");
            await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FCJ_DEL_MEDIA error:", e); }
    });

    // NEW: Force channel join — See text
    bot.action(/^FCJ_SEE_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const msg = doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.message;
            if (!msg || !String(msg).trim()) {
                await ctx.answerCbQuery("No custom text set.");
                return;
            }
            await ctx.reply(msg, {
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]]),
            });
        } catch (e) { console.error("FCJ_SEE_TEXT error:", e); }
    });

    // NEW: Force channel join — See media
    bot.action(/^FCJ_SEE_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const media = doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.media;
            const type = doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.media_type;
            if (!media || !type) {
                await ctx.answerCbQuery("No media set.");
                return;
            }
            const kb = { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", `OPEN_FORCE_CHANNEL_${chatIdStr}`)]]) };
            if (type === "photo") await ctx.replyWithPhoto(media, kb);
            else if (type === "video") await ctx.replyWithVideo(media, kb);
            else if (type === "document") await ctx.replyWithDocument(media, kb);
            else await ctx.answerCbQuery("Unsupported media type.");
        } catch (e) { console.error("FCJ_SEE_MEDIA error:", e); }
    });

    // Force member add: On/Off
    bot.action(/^FMA_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force.member_add`]: true } },
                { upsert: true }
            );
            await ctx.answerCbQuery("Force member add: On");
            await renderForceMemberAddMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FMA_TURN_ON error:", e); }
    });

    bot.action(/^FMA_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force.member_add`]: false } },
                { upsert: true }
            );
            await ctx.answerCbQuery("Force member add: Off");
            await renderForceMemberAddMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FMA_TURN_OFF error:", e); }
    });

    // Force member add: min/text/media (input screens show “🚫 Remove message” + “Cancel”)
    bot.action(/^FMA_SET_MIN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const msg =
                "🔢 <b>Set minimum members to add</b>\n\n" +
                "Send a whole number (0..10000).";

            const sent = await safeEditOrSend(ctx, msg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `OPEN_FORCE_ADD_${chatIdStr}`)]])
            }, true);
            ctx.session = ctx.session || {};
            ctx.session.awaitingFMAMin = { chatIdStr, userId, promptMessageId: sent };
            await ctx.answerCbQuery();
        } catch (e) { console.error("FMA_SET_MIN error:", e); }
    });

    bot.action(/^FMA_SET_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const msg =
                "📝 <b>Set force member add prompt text</b>\n\n" +
                "Send the text shown until the user meets the minimum add requirement.\n" +
                "Placeholders: {name}, {mention}";

            const sent = await safeEditOrSend(ctx, msg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("🚫 Remove message", `FMA_DEL_TEXT_${chatIdStr}`)],
                    [Markup.button.callback("❌ Cancel", `OPEN_FORCE_ADD_${chatIdStr}`)]
                ])
            }, true);
            ctx.session = ctx.session || {};
            ctx.session.awaitingFMAText = { chatIdStr, userId, promptMessageId: sent };
            await ctx.answerCbQuery();
        } catch (e) { console.error("FMA_SET_TEXT error:", e); }
    });

    bot.action(/^FMA_DEL_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = doc?.settings?.[chatIdStr]?.checks?.force_add_member?.add_message;
            if (!cur || !String(cur).trim()) {
                await ctx.answerCbQuery("Nothing to delete.");
                return await renderForceMemberAddMenu(ctx, chatIdStr, userId);
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.checks.force_add_member.add_message`]: "" } }
            );
            await ctx.answerCbQuery("Removed add prompt text.");
            await renderForceMemberAddMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FMA_DEL_TEXT error:", e); }
    });

    bot.action(/^FMA_SET_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const msg =
                "🖼️ <b>Set force member add prompt media</b>\n\n" +
                "Send a photo, video, or document (caption ignored).";

            const sent = await safeEditOrSend(ctx, msg, {
                parse_mode: "HTML",
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback("🚫 Remove message", `FMA_DEL_MEDIA_${chatIdStr}`)],
                    [Markup.button.callback("❌ Cancel", `OPEN_FORCE_ADD_${chatIdStr}`)]
                ])
            }, true);
            ctx.session = ctx.session || {};
            ctx.session.awaitingFMAMedia = { chatIdStr, userId, promptMessageId: sent };
            await ctx.answerCbQuery();
        } catch (e) { console.error("FMA_SET_MEDIA error:", e); }
    });

    bot.action(/^FMA_DEL_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const has = !!(doc?.settings?.[chatIdStr]?.checks?.force_add_member?.media && doc?.settings?.[chatIdStr]?.checks?.force_add_member?.media_type);
            if (!has) {
                await ctx.answerCbQuery("Nothing to delete.");
                return await renderForceMemberAddMenu(ctx, chatIdStr, userId);
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                { $unset: { [`settings.${chatIdStr}.checks.force_add_member.media`]: "", [`settings.${chatIdStr}.checks.force_add_member.media_type`]: "" } }
            );
            await ctx.answerCbQuery("Removed add prompt media.");
            await renderForceMemberAddMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("FMA_DEL_MEDIA error:", e); }
    });

    // NEW: Force member add — See text
    bot.action(/^FMA_SEE_TEXT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const msg = doc?.settings?.[chatIdStr]?.checks?.force_add_member?.add_message;
            if (!msg || !String(msg).trim()) {
                await ctx.answerCbQuery("No custom text set.");
                return;
            }
            await ctx.reply(msg, {
                reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", `OPEN_FORCE_ADD_${chatIdStr}`)]]),
            });
        } catch (e) { console.error("FMA_SEE_TEXT error:", e); }
    });

    // NEW: Force member add — See media
    bot.action(/^FMA_SEE_MEDIA_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1], userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const media = doc?.settings?.[chatIdStr]?.checks?.force_add_member?.media;
            const type = doc?.settings?.[chatIdStr]?.checks?.force_add_member?.media_type;
            if (!media || !type) {
                await ctx.answerCbQuery("No media set.");
                return;
            }
            const kb = { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", `OPEN_FORCE_ADD_${chatIdStr}`)]]) };
            if (type === "photo") await ctx.replyWithPhoto(media, kb);
            else if (type === "video") await ctx.replyWithVideo(media, kb);
            else if (type === "document") await ctx.replyWithDocument(media, kb);
            else await ctx.answerCbQuery("Unsupported media type.");
        } catch (e) { console.error("FMA_SEE_MEDIA error:", e); }
    });

    // Name block toggles
    bot.action(/^TOGGLE_BLK_(arabic|chinese|russian|spam)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1]; const chatIdStr = ctx.match[2]; const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!doc?.settings?.[chatIdStr]?.checks?.name_blocks?.[key];

            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.name_blocks.${key}`]: !cur } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`${key} block: ${!cur ? "On" : "Off"}`);
            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (e) { console.error("TOGGLE_BLK error:", e); }
    });
    // checks.js (Part 3/3) — unified text/media input handlers

    bot.on(["text", "photo", "video", "document"], async (ctx, next) => {
        try {
            ctx.session = ctx.session || {};

            // Force channel join — Add channel
            if (ctx.session.awaitingFCJAddChannel) {
                const { chatIdStr, userId, promptMessageId } = ctx.session.awaitingFCJAddChannel;
                const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) { delete ctx.session.awaitingFCJAddChannel; return; }

                if (!("text" in ctx.message)) { await ctx.reply("❌ Please send channel @username / t.me link / -100id."); return; }
                const normalized = normalizeChannel(ctx.message.text);
                if (!normalized) { await ctx.reply("❌ Invalid input."); return; }

                const doc = await user_setting_module.findOne({ user_id: userId }).lean();
                const arr = (doc?.settings?.[chatIdStr]?.checks?.force_channel_join?.channels || []).slice();
                if (!arr.includes(normalized)) arr.push(normalized);

                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force_channel_join.channels`]: arr } },
                    { upsert: true }
                );

                if (promptMessageId) { try { await ctx.deleteMessage(promptMessageId); } catch (_) { } }
                await ctx.reply(`✅ Added channel: <b>${normalized}</b>`, { parse_mode: "HTML" });
                delete ctx.session.awaitingFCJAddChannel;
                await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
                return;
            }

            // Force channel join — Set text
            if (ctx.session.awaitingFCJText) {
                const { chatIdStr, userId, promptMessageId } = ctx.session.awaitingFCJText;
                const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) { delete ctx.session.awaitingFCJText; return; }

                if (!("text" in ctx.message)) { await ctx.reply("❌ Please send text."); return; }
                const raw = ctx.message.text.trim();
                if (!raw) { await ctx.reply("❌ Message cannot be empty."); return; }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force_channel_join.message`]: raw } },
                    { upsert: true }
                );

                if (promptMessageId) { try { await ctx.deleteMessage(promptMessageId); } catch (_) { } }
                await ctx.reply("✅ Saved channel prompt text.", { parse_mode: "HTML" });
                delete ctx.session.awaitingFCJText;
                await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
                return;
            }

            // Force channel join — Set media
            if (ctx.session.awaitingFCJMedia) {
                const { chatIdStr, userId, promptMessageId } = ctx.session.awaitingFCJMedia;
                const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) { delete ctx.session.awaitingFCJMedia; return; }

                const media = extractMediaForSchema(ctx.message);
                if (!media) { await ctx.reply("❌ Send a photo, video, or document."); return; }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.checks.force_channel_join.media`]: media.media,
                            [`settings.${chatIdStr}.checks.force_channel_join.media_type`]: media.media_type
                        }
                    },
                    { upsert: true }
                );

                if (promptMessageId) { try { await ctx.deleteMessage(promptMessageId); } catch (_) { } }
                await ctx.reply("✅ Saved channel prompt media.", { parse_mode: "HTML" });
                delete ctx.session.awaitingFCJMedia;
                await renderForceChannelJoinMenu(ctx, chatIdStr, userId);
                return;
            }

            // Force member add — Set minimum
            if (ctx.session.awaitingFMAMin) {
                const { chatIdStr, userId, promptMessageId } = ctx.session.awaitingFMAMin;
                const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) { delete ctx.session.awaitingFMAMin; return; }

                if (!("text" in ctx.message)) { await ctx.reply("❌ Please send a number."); return; }
                const n = Number((ctx.message.text || "").trim());
                if (!Number.isInteger(n) || n < 0 || n > 10000) {
                    await ctx.reply("❌ Send a whole number 0..10000."); return;
                }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force_add_member.add_min`]: n } },
                    { upsert: true }
                );

                if (promptMessageId) { try { await ctx.deleteMessage(promptMessageId); } catch (_) { } }
                await ctx.reply(`✅ Minimum set to: <b>${n}</b>`, { parse_mode: "HTML" });
                delete ctx.session.awaitingFMAMin;
                await renderForceMemberAddMenu(ctx, chatIdStr, userId);
                return;
            }

            // Force member add — Set text
            if (ctx.session.awaitingFMAText) {
                const { chatIdStr, userId, promptMessageId } = ctx.session.awaitingFMAText;
                const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) { delete ctx.session.awaitingFMAText; return; }

                if (!("text" in ctx.message)) { await ctx.reply("❌ Please send text."); return; }
                const raw = ctx.message.text.trim();
                if (!raw) { await ctx.reply("❌ Message cannot be empty."); return; }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.checks.force_add_member.add_message`]: raw } },
                    { upsert: true }
                );

                if (promptMessageId) { try { await ctx.deleteMessage(promptMessageId); } catch (_) { } }
                await ctx.reply("✅ Saved add prompt text.", { parse_mode: "HTML" });
                delete ctx.session.awaitingFMAText;
                await renderForceMemberAddMenu(ctx, chatIdStr, userId);
                return;
            }

            // Force member add — Set media
            if (ctx.session.awaitingFMAMedia) {
                const { chatIdStr, userId, promptMessageId } = ctx.session.awaitingFMAMedia;
                const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) { delete ctx.session.awaitingFMAMedia; return; }

                const media = extractMediaForSchema(ctx.message);
                if (!media) { await ctx.reply("❌ Send a photo, video, or document."); return; }

                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.checks.force_add_member.media`]: media.media,
                            [`settings.${chatIdStr}.checks.force_add_member.media_type`]: media.media_type
                        }
                    },
                    { upsert: true }
                );

                if (promptMessageId) { try { await ctx.deleteMessage(promptMessageId); } catch (_) { } }
                await ctx.reply("✅ Saved add prompt media.", { parse_mode: "HTML" });
                delete ctx.session.awaitingFMAMedia;
                await renderForceMemberAddMenu(ctx, chatIdStr, userId);
                return;
            }
        } catch (e) {
            console.error("Force checks input handler error:", e);
            try { await ctx.reply("⚠️ Something went wrong while saving. Please try again."); } catch (_) { }
            if (ctx.session) {
                delete ctx.session.awaitingFCJAddChannel;
                delete ctx.session.awaitingFCJText;
                delete ctx.session.awaitingFCJMedia;
                delete ctx.session.awaitingFMAMin;
                delete ctx.session.awaitingFMAText;
                delete ctx.session.awaitingFMAMedia;
            }
        }

        if (typeof next === "function") await next();
    });
};