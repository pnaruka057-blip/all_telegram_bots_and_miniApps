// handlers/blocks_menu.js
const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// Render main Blocks menu
async function renderBlocksMenu(ctx, chatIdStr, userId) {
    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;
    const rows = [
        [Markup.button.callback("⛔ Blacklist", `OPEN_BLOCK_blacklist_${chatIdStr}`)],
        [Markup.button.callback("🤖 Bot block", `OPEN_BLOCK_botblock_${chatIdStr}`)],
        [Markup.button.callback("🙂 Join block", `OPEN_BLOCK_joinblock_${chatIdStr}`)],
        [Markup.button.callback("📕 Leave block", `OPEN_BLOCK_leaveblock_${chatIdStr}`)],
        [Markup.button.callback("🏃‍♂️ Join-Leave block", `OPEN_BLOCK_joinleave_${chatIdStr}`)],
        [Markup.button.callback("👨‍👩‍👧‍👦 Multiple joins block", `OPEN_BLOCK_multiple_joins_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    const text = `<b>🔒 Blocks</b>\n\n<i>Manage different block rules for <b>${isOwner?.title}</b>. Click any option below to view and configure.</i>`;

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// Generic detail renderer (customized per key)
async function renderBlockDetail(ctx, chatIdStr, userId, key) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const block = userDoc?.settings?.[chatIdStr]?.blocks?.[key] || {};

    const enabled = !!block.enabled;
    const status = enabled ? "On ✅" : "Off ❌";
    const punishment = (block.punishment || "off").toUpperCase();
    const users = Array.isArray(block.users) ? block.users : [];

    let title = "";
    let body = "";
    const rows = [];

    switch (key) {
        case "blacklist": {
            title = "⛔ Blacklist";
            body =
                `Manage a list of users who are permanently blacklisted from the group.\n\n` +
                `• Blacklisted users will be blocked from joining or sending messages.\n` +
                `• Use Add / Remove to edit the list.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment}\n` +
                `- Entries: ${users.length}\n\n` +
                `<i>Use blow options to manage blacklist</i>`

            // Separate Turn On / Turn Off buttons
            rows.push([
                Markup.button.callback("✅ Turn on", `BLOCK_SET_enabled_true_${key}_${chatIdStr}`),
                Markup.button.callback("❌ Turn off", `BLOCK_SET_enabled_false_${key}_${chatIdStr}`)
            ]);

            // Manage users
            rows.push([
                Markup.button.callback("➕ Add user", `SET_${key.toUpperCase()}_ADD_USER_${chatIdStr}`),
                Markup.button.callback("➖ Remove user", `SET_${key.toUpperCase()}_REMOVE_USER_${chatIdStr}`)
            ]);

            // View users
            rows.push([Markup.button.callback("👀 View users", `VIEW_${key.toUpperCase()}_USERS_${chatIdStr}`)]);

            // Punishments: Off, Ban, Mute
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;
        }

        case "botblock": {
            title = "🤖 Bot block";
            body =
                `If you enable this feature, users will not be able to add bots to the group.\n` +
                `You can also choose a penalty for users who try to do it.\n\n` +
                `- Status: ${punishment}\n\n` +
                `<i>Use blow options to manage botblock</i>`

            // Punishments: Off, Warn, Kick, Ban, Mute
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("❗ Warn", `BLOCK_PUNISH_warn_${key}_${chatIdStr}`),
                Markup.button.callback("❗ Kick", `BLOCK_PUNISH_kick_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;
        }

        case "joinblock": {
            title = "🙂 Join block";
            body =
                `Give a penalty to users or bots that try to join the group.\n\n` +
                `- Status: ${punishment}\n\n` +
                `<i>Use blow options to manage joinblock</i>`

            // Punishments: Off, Ban, Mute
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;
        }

        case "leaveblock": {
            title = "📕 Leave block";
            body =
                `Ban for users who leave the group.\n\n` +
                `- Status: ${punishment}\n\n` +
                `<i>Use blow options to manage leaveblock</i>`

            // Punishments: Off, Ban
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;
        }

        case "joinleave": {
            title = "🏃‍♂️ Join-Leave block";

            const delEnabled = !!block.delete_service_message;
            const delStatus = delEnabled ? "On ✅" : "Off ❌";
            const currentSecs = typeof block.jl_time_seconds === "number" ? block.jl_time_seconds : 3;
            const currentLimit = typeof block.jl_limit === "number" ? block.jl_limit : 2;

            body =
                `Delete the quick join-then-leave service/welcome messages and optionally penalize.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment}\n` +
                `- Delete messages: ${delStatus}\n\n` +
                `If someone leaves within <b>${currentSecs}</b> seconds after joining, it counts as one quick-leave. When this happens <b>${currentLimit}</b> times (each within <b>${currentSecs}</b> seconds of joining), the selected penalty will be applied.\n\n` +
                `<i>Use blow options to manage joinleave</i>`

            // Separate Turn On / Turn Off buttons for Join-Leave (with defaulting on Turn on)
            rows.push([
                Markup.button.callback("✅ Turn on", `BLOCK_SET_enabled_true_joinleave_${chatIdStr}`),
                Markup.button.callback("❌ Turn off", `BLOCK_SET_enabled_false_joinleave_${chatIdStr}`)
            ]);

            // Delete toggle
            rows.push([
                Markup.button.callback(`🗑️ Delete message: ${delStatus}`, `BLOCK_ACTION_delete_${key}_${chatIdStr}`)
            ]);

            // Pickers
            rows.push([
                Markup.button.callback(`⏱️ Set Time (${currentSecs}s)`, `JOINLEAVE_SET_TIME_${chatIdStr}`),
                Markup.button.callback(`👣 Set Join-Leave Limit (${currentLimit})`, `JOINLEAVE_SET_LIMIT_${chatIdStr}`)
            ]);

            // Punishments: Off, Ban, Mute, Warn
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`),
                Markup.button.callback("❗ Warn", `BLOCK_PUNISH_warn_${key}_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;
        }

        case "multiple_joins": {
            title = "👨‍👩‍👧‍👦 Multiple joins block";
            const limitForJoin = Number(block.limit_for_join ?? 4);
            const secs = Number(block.multiple_join_seconds ?? 2);

            body =
                `Give a penalty if ${limitForJoin} users join the group within ${secs} seconds.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment}\n\n` +
                `<i>Use blow options to manage multiple joins</i>`

            // Separate Turn On / Turn Off buttons for Multiple Joins (with defaulting on Turn on)
            rows.push([
                Markup.button.callback("✅ Turn on", `BLOCK_SET_enabled_true_multiple_joins_${chatIdStr}`),
                Markup.button.callback("❌ Turn off", `BLOCK_SET_enabled_false_multiple_joins_${chatIdStr}`)
            ]);

            // Punishments: Off, Mute, Ban
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);

            // Set joins (limit_for_join) and time (multiple_join_seconds)
            rows.push([
                Markup.button.callback(`👥 Set joins (${limitForJoin})`, `SET_MULTIPLE_JOINS_SET_LIMIT_${chatIdStr}`),
                Markup.button.callback(`⏱️ Set time (${secs}s)`, `SET_MULTIPLE_JOINS_SET_TIME_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;
        }

        default: {
            title = "Unknown block";
            body = `Unknown block key: ${key}\n\n- Status: ${status}`;
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
        }
    }

    await safeEditOrSend(ctx, `<b>${title}</b>\n\n${body}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

async function resolveCandidate(ctx, candidate) {
    try {
        if (candidate && typeof candidate === "object" && candidate.id) {
            return { ok: true, value: String(candidate.id) };
        }
        if (!candidate || typeof candidate !== "string") {
            return { ok: false, error: "Invalid input type. Send a forwarded user, @username or numeric id." };
        }
        const v = candidate.trim();
        if (/^-?\d+$/.test(v)) {
            try {
                await ctx.telegram.getChat(v);
                return { ok: true, value: String(v) };
            } catch {
                return { ok: false, error: `Could not resolve chat id ${v}.` };
            }
        }
        const maybeUsername = v.startsWith("@") ? v.slice(1) : v;
        if (/^[A-Za-z0-9_]{5,32}$/.test(maybeUsername)) {
            return { ok: true, value: `@${maybeUsername}` };
        }
        return { ok: false, error: "Send a valid @username (5-32 chars) or numeric chat id, or forward a user's message." };
    } catch {
        return { ok: false, error: "Validation error" };
    }
}

module.exports = (bot) => {
    // Open main blocks menu
    bot.action(/^SET_BLOCKS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderBlocksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_BLOCKS error:", err);
        }
    });

    // Open each block detail
    bot.action(/^OPEN_BLOCK_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("OPEN_BLOCK error:", err);
        }
    });

    // Blacklist explicit On/Off
    bot.action(/^BLOCK_SET_enabled_(true|false)_(blacklist)_(-?\d+)$/, async (ctx) => {
        try {
            const want = ctx.match[1] === "true";
            const key = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.blocks.${key}.enabled`]: want } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Status: ${want ? "On" : "Off"}`);
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("BLOCK_SET_enabled error:", err);
        }
    });

    // Join-Leave explicit On/Off with defaults applied when turning on
    bot.action(/^BLOCK_SET_enabled_(true|false)_(joinleave)_(-?\d+)$/, async (ctx) => {
        try {
            const want = ctx.match[1] === "true";
            const key = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const jl = userDoc?.settings?.[chatIdStr]?.blocks?.joinleave || {};
            const updates = { [`settings.${chatIdStr}.blocks.${key}.enabled`]: want };

            // Apply defaults when turning on if not set
            if (want) {
                if (typeof jl.jl_time_seconds !== "number") {
                    updates[`settings.${chatIdStr}.blocks.${key}.jl_time_seconds`] = 3;
                }
                if (typeof jl.jl_limit !== "number") {
                    updates[`settings.${chatIdStr}.blocks.${key}.jl_limit`] = 2;
                }
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: updates
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Join-Leave: ${want ? "On" : "Off"}`);
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("BLOCK_SET_enabled joinleave error:", err);
        }
    });

    // Multiple joins explicit On/Off with defaults applied when turning on
    bot.action(/^BLOCK_SET_enabled_(true|false)_(multiple_joins)_(-?\d+)$/, async (ctx) => {
        try {
            const want = ctx.match[1] === "true";
            const key = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const mj = userDoc?.settings?.[chatIdStr]?.blocks?.multiple_joins || {};
            const updates = { [`settings.${chatIdStr}.blocks.${key}.enabled`]: want };

            // Apply defaults when turning on if not set
            if (want) {
                if (typeof mj.limit_for_join !== "number") {
                    updates[`settings.${chatIdStr}.blocks.${key}.limit_for_join`] = 4;
                }
                if (typeof mj.multiple_join_seconds !== "number") {
                    updates[`settings.${chatIdStr}.blocks.${key}.multiple_join_seconds`] = 2;
                }
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: updates
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Multiple joins: ${want ? "On" : "Off"}`);
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("BLOCK_SET_enabled multiple_joins error:", err);
        }
    });

    // View users list (Blacklist)
    bot.action(/^VIEW_([A-Z_]+)_USERS_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const users = userDoc?.settings?.[chatIdStr]?.blocks?.[key]?.users || [];

            if (!users.length) {
                await ctx.answerCbQuery("No entries found.");
                return renderBlockDetail(ctx, chatIdStr, userId, key);
            }

            const listText = users.map((u, i) => `${i + 1}. ${u}`).join("\n");
            await safeEditOrSend(ctx, `<b>👥 ${key} users</b>\n\n${listText}`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `OPEN_BLOCK_${key}_${chatIdStr}`)]] }
            });
        } catch (err) {
            console.error("VIEW_USERS error:", err);
        }
    });

    // Start Add user (Blacklist)
    bot.action(/^SET_([A-Z_]+)_ADD_USER_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            theUserId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, theUserId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.blockAwait = { action: "add", key, chatIdStr, ownerId: theUserId, promptMessageId: null };

            const textMsg = `✍️ <b>Send now the user you want to ADD to <i>${key}</i>.</b>\n<i>Send @username or numeric user id, or forward a user's message.</i>`;
            const buttons = [[Markup.button.callback("❌ Cancel", `CANCEL_BLOCK_ADD_${key}_${chatIdStr}`)]];

            await ctx.answerCbQuery("Send the user id or @username to add (in this chat).");
            const botMsg = await safeEditOrSend(ctx, textMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            try {
                const msgId = botMsg?.message_id
                    || botMsg?.message?.message_id
                    || ctx.callbackQuery?.message?.message_id
                    || (ctx.message && ctx.message.message_id);
                if (msgId) ctx.session.blockAwait.promptMessageId = msgId;
            } catch { }
        } catch (err) {
            console.error("SET_ADD_USER error:", err);
        }
    });

    // Cancel add
    bot.action(/^CANCEL_BLOCK_ADD_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = ctx.session || {};
            const promptId = ctx.session.blockAwait?.promptMessageId;
            if (promptId) { try { await ctx.deleteMessage(promptId); } catch { } }
            delete ctx.session.blockAwait;

            await ctx.answerCbQuery("Add operation cancelled.");
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            await renderBlockDetail(ctx, chatIdStr, ctx.from.id, key);
        } catch (err) {
            console.error("CANCEL_BLOCK_ADD error:", err);
        }
    });

    // Start Remove user (Blacklist)
    bot.action(/^SET_([A-Z_]+)_REMOVE_USER_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const theUserId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, theUserId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.blockAwait = { action: "remove", key, chatIdStr, ownerId: theUserId, promptMessageId: null };

            const textMsg = `✍️ <b>Send now the user you want to REMOVE from <i>${key}</i>.</b>\n<i>Send @username or numeric user id, or forward a user's message.</i>`;
            const buttons = [[Markup.button.callback("❌ Cancel", `CANCEL_BLOCK_REMOVE_${key}_${chatIdStr}`)]];

            await ctx.answerCbQuery("Send the user id or @username to remove (in this chat).");
            const botMsg = await safeEditOrSend(ctx, textMsg, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            try {
                const msgId = botMsg?.message_id
                    || botMsg?.message?.message_id
                    || ctx.callbackQuery?.message?.message_id
                    || (ctx.message && ctx.message.message_id);
                if (msgId) ctx.session.blockAwait.promptMessageId = msgId;
            } catch { }
        } catch (err) {
            console.error("SET_REMOVE_USER error:", err);
        }
    });

    // Cancel remove
    bot.action(/^CANCEL_BLOCK_REMOVE_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = ctx.session || {};
            const promptId = ctx.session.blockAwait?.promptMessageId;
            if (promptId) { try { await ctx.deleteMessage(promptId); } catch { } }
            delete ctx.session.blockAwait;

            await ctx.answerCbQuery("Remove operation cancelled.");
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            await renderBlockDetail(ctx, chatIdStr, ctx.from.id, key);
        } catch (err) {
            console.error("CANCEL_BLOCK_REMOVE error:", err);
        }
    });

    // Generic punishment setter for all blocks (no auto-enable/disable here per your latest file)
    bot.action(/^BLOCK_PUNISH_(off|warn|kick|mute|ban)_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const p = ctx.match[1];
            const key = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: {
                        [`settings.${chatIdStr}.blocks.${key}.punishment`]: p
                    }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Punishment set: ${p.toUpperCase()}`);
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("BLOCK_PUNISH error:", err);
        }
    });

    // Join-Leave: Delete toggle
    bot.action(/^BLOCK_ACTION_delete_(joinleave)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = !!(userDoc?.settings?.[chatIdStr]?.blocks?.[key]?.delete_service_message);
            const newVal = !current;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.blocks.${key}.delete_service_message`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete-on-quick-leave: ${newVal ? "On ✅" : "Off ❌"}`);
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("JOINLEAVE delete toggle error:", err);
        }
    });

    // Join-Leave: Set Time picker (1..20)
    bot.action(/^JOINLEAVE_SET_TIME_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const jl = userDoc?.settings?.[chatIdStr]?.blocks?.joinleave || {};
            const currentSecs = typeof jl.jl_time_seconds === "number" ? jl.jl_time_seconds : 3;
            const currentLimit = typeof jl.jl_limit === "number" ? jl.jl_limit : 2;

            const text =
                `Select the Join-Leave time window in seconds.\n` +
                `Currently: Time <b>${currentSecs}</b>s, Limit <b>${currentLimit}</b>.\n\n` +
                `<i>Choose seconds (1–20):</i>`;

            const keyboardRows = [];
            let row = [];
            for (let i = 1; i <= 20; i++) {
                row.push(Markup.button.callback(String(i), `JOINLEAVE_SET_TIME_VALUE_${i}_${chatIdStr}`));
                if (row.length === 4) { keyboardRows.push(row); row = []; }
            }
            if (row.length) keyboardRows.push(row);

            keyboardRows.push([
                Markup.button.callback("⬅️ Back", `OPEN_BLOCK_joinleave_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboardRows } });
        } catch (err) {
            console.error("JOINLEAVE_SET_TIME handler error:", err);
        }
    });

    // Join-Leave: Set Limit picker (1..20)
    bot.action(/^JOINLEAVE_SET_LIMIT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const jl = userDoc?.settings?.[chatIdStr]?.blocks?.joinleave || {};
            const currentSecs = typeof jl.jl_time_seconds === "number" ? jl.jl_time_seconds : 3;
            const currentLimit = typeof jl.jl_limit === "number" ? jl.jl_limit : 2;

            const text =
                `Select how many quick leave events (within Time) trigger enforcement.\n` +
                `Currently: Time <b>${currentSecs}</b>s, Limit <b>${currentLimit}</b>.\n\n` +
                `<i>Choose a number (1–20):</i>`;

            const keyboardRows = [];
            let row = [];
            for (let i = 1; i <= 20; i++) {
                row.push(Markup.button.callback(String(i), `JOINLEAVE_SET_LIMIT_VALUE_${i}_${chatIdStr}`));
                if (row.length === 4) { keyboardRows.push(row); row = []; }
            }
            if (row.length) keyboardRows.push(row);

            keyboardRows.push([
                Markup.button.callback("⬅️ Back", `OPEN_BLOCK_joinleave_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboardRows } });
        } catch (err) {
            console.error("JOINLEAVE_SET_LIMIT handler error:", err);
        }
    });

    // Persist Join-Leave time
    bot.action(/^JOINLEAVE_SET_TIME_VALUE_([1-9]|1[0-9]|20)_(-?\d+)$/, async (ctx) => {
        try {
            const secs = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.blocks.joinleave.jl_time_seconds`]: secs }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Time set: ${secs}s`);
            await renderBlockDetail(ctx, chatIdStr, userId, "joinleave");
        } catch (err) {
            console.error("JOINLEAVE_SET_TIME_VALUE error:", err);
        }
    });

    // Persist Join-Leave limit
    bot.action(/^JOINLEAVE_SET_LIMIT_VALUE_([1-9]|1[0-9]|20)_(-?\d+)$/, async (ctx) => {
        try {
            const limit = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.blocks.joinleave.jl_limit`]: limit }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Limit set: ${limit}`);
            await renderBlockDetail(ctx, chatIdStr, userId, "joinleave");
        } catch (err) {
            console.error("JOINLEAVE_SET_LIMIT_VALUE error:", err);
        }
    });

    // Multiple joins: Set joins (limit_for_join)
    bot.action(/^SET_MULTIPLE_JOINS_SET_LIMIT_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const mj = userDoc?.settings?.[chatIdStr]?.blocks?.multiple_joins || {};
            const currentLimit = Number(mj.limit_for_join ?? 4);
            const currentSecs = Number(mj.multiple_join_seconds ?? 2);

            const text =
                `Set the number of joins that trigger the rule within the time window.\n` +
                `Currently: Joins <b>${currentLimit}</b>, Time <b>${currentSecs}</b>s.\n\n` +
                `<i>Choose a number (1–20):</i>`;

            const keyboardRows = [];
            let row = [];
            for (let i = 1; i <= 20; i++) {
                row.push(Markup.button.callback(String(i), `MULTIPLE_JOINS_SET_LIMIT_VALUE_${i}_${chatIdStr}`));
                if (row.length === 4) { keyboardRows.push(row); row = []; }
            }
            if (row.length) keyboardRows.push(row);

            keyboardRows.push([
                Markup.button.callback("⬅️ Back", `OPEN_BLOCK_multiple_joins_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboardRows } });
        } catch (err) {
            console.error("SET_MULTIPLE_JOINS_SET_LIMIT error:", err);
        }
    });

    // Multiple joins: Set time (multiple_join_seconds)
    bot.action(/^SET_MULTIPLE_JOINS_SET_TIME_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const mj = userDoc?.settings?.[chatIdStr]?.blocks?.multiple_joins || {};
            const currentLimit = Number(mj.limit_for_join ?? 4);
            const currentSecs = Number(mj.multiple_join_seconds ?? 2);

            const text =
                `Set the time window (seconds) for multiple joins.\n` +
                `Currently: Joins <b>${currentLimit}</b>, Time <b>${currentSecs}</b>s.\n\n` +
                `<i>Choose seconds (1–20):</i>`;

            const keyboardRows = [];
            let row = [];
            for (let i = 1; i <= 20; i++) {
                row.push(Markup.button.callback(String(i), `MULTIPLE_JOINS_SET_TIME_VALUE_${i}_${chatIdStr}`));
                if (row.length === 4) { keyboardRows.push(row); row = []; }
            }
            if (row.length) keyboardRows.push(row);

            keyboardRows.push([
                Markup.button.callback("⬅️ Back", `OPEN_BLOCK_multiple_joins_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);

            await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboardRows } });
        } catch (err) {
            console.error("SET_MULTIPLE_JOINS_SET_TIME error:", err);
        }
    });

    // Persist Multiple joins: limit_for_join
    bot.action(/^MULTIPLE_JOINS_SET_LIMIT_VALUE_([1-9]|1[0-9]|20)_(-?\d+)$/, async (ctx) => {
        try {
            const limit = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.blocks.multiple_joins.limit_for_join`]: limit } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Joins limit set: ${limit}`);
            await renderBlockDetail(ctx, chatIdStr, userId, "multiple_joins");
        } catch (err) {
            console.error("MULTIPLE_JOINS_SET_LIMIT_VALUE error:", err);
        }
    });

    // Persist Multiple joins: multiple_join_seconds
    bot.action(/^MULTIPLE_JOINS_SET_TIME_VALUE_([1-9]|1[0-9]|20)_(-?\d+)$/, async (ctx) => {
        try {
            const secs = Number(ctx.match[1]);
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.blocks.multiple_joins.multiple_join_seconds`]: secs } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Time set: ${secs}s`);
            await renderBlockDetail(ctx, chatIdStr, userId, "multiple_joins");
        } catch (err) {
            console.error("MULTIPLE_JOINS_SET_TIME_VALUE error:", err);
        }
    });

    // Message listener for Blacklist add/remove
    bot.on('message', async (ctx, next) => {
        try {
            ctx.session = ctx.session || {};
            if (ctx?.session?.blockAwait) {
                const awaitObj = ctx.session.blockAwait;
                if (!awaitObj) return;

                const { action, key, chatIdStr, ownerId } = awaitObj;
                const senderId = ctx.from?.id;
                if (!senderId || Number(ownerId) !== Number(senderId)) return;

                const promptId = ctx.session.blockAwait?.promptMessageId;
                if (promptId) { try { await ctx.deleteMessage(promptId); } catch { } delete ctx.session.blockAwait.promptMessageId; }

                // Resolve candidate from message
                let raw = null;
                if (ctx.message.forward_from) raw = ctx.message.forward_from;
                else if (ctx.message.forward_from_chat) raw = String(ctx.message.forward_from_chat.id);
                else if (ctx.message.text) raw = ctx.message.text.trim();
                else if (ctx.message.caption) raw = ctx.message.caption.trim();

                if (!raw) {
                    await ctx.reply("No valid user id / username / forwarded message detected. Please forward a user's message or send @username / user id.");
                    return;
                }

                const resolved = await resolveCandidate(ctx, raw);
                if (!resolved.ok) {
                    await ctx.reply(`${resolved.error} Please try again or press Cancel.`);
                    return;
                }
                const value = resolved.value;

                if (action === 'add') {
                    await user_setting_module.updateOne(
                        { user_id: ownerId },
                        { $setOnInsert: { user_id: ownerId }, $addToSet: { [`settings.${chatIdStr}.blocks.${key}.users`]: value } },
                        { upsert: true }
                    );

                    delete ctx.session.blockAwait;
                    await ctx.reply(`✅ Added \`${value}\` to ${key}.`, { parse_mode: "Markdown" });
                    try { await renderBlockDetail(ctx, chatIdStr, ownerId, key); } catch { }
                    return;
                }

                if (action === 'remove') {
                    await user_setting_module.updateOne(
                        { user_id: ownerId },
                        { $pull: { [`settings.${chatIdStr}.blocks.${key}.users`]: value } }
                    );

                    delete ctx.session.blockAwait;
                    await ctx.reply(`✅ Removed \`${value}\` from ${key} (if present).`, { parse_mode: "Markdown" });
                    try { await renderBlockDetail(ctx, chatIdStr, ownerId, key); } catch { }
                    return;
                }
            }
        } catch (err) {
            console.error("blocks_menu message handler error:", err);
        }

        if (typeof next === "function") await next();
    });
};
