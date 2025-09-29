// handlers/blocks_menu.js
const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// render main Blocks menu
async function renderBlocksMenu(ctx, chatIdStr, userId) {
    const rows = [
        [Markup.button.callback("⛔ Blacklist", `OPEN_BLOCK_blacklist_${chatIdStr}`)],
        [Markup.button.callback("🤖 Bot block", `OPEN_BLOCK_botblock_${chatIdStr}`)],
        [Markup.button.callback("🙂 Join block", `OPEN_BLOCK_joinblock_${chatIdStr}`)],
        [Markup.button.callback("📕 Leave block", `OPEN_BLOCK_leaveblock_${chatIdStr}`)],
        [Markup.button.callback("🏃‍♂️ Join-Leave block", `OPEN_BLOCK_joinleave_${chatIdStr}`)],
        [Markup.button.callback("👥 Multiple joins block", `OPEN_BLOCK_multiple_joins_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    const text = `<b>🔒 Blocks</b>\n\nManage different block rules for this group. Click any option below to view and configure.`;

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// generic detail renderer for each block key (customized per key)
async function renderBlockDetail(ctx, chatIdStr, userId, key) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const block = userDoc?.settings?.[chatIdStr]?.blocks?.[key] || {};

    const enabled = !!block.enabled;
    const status = enabled ? "On ✅" : "Off ❌";
    const punishment = block.punishment || "off";
    const users = Array.isArray(block.users) ? block.users : [];

    let title = "";
    let body = "";

    // default keyboard rows — will be overridden per key as needed
    let rows = [];

    switch (key) {
        case "blacklist":
            title = "⛔ Blacklist";
            body =
                `Manage a list of users who are permanently blacklisted from the group.\n\n` +
                `• Blacklisted users will be blocked from joining or sending messages.\n` +
                `• Use Add / Remove to edit the list.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Entries: ${users.length}`;

            // Manage Users row
            rows.push([
                Markup.button.callback("➕ Add user", `SET_${key.toUpperCase()}_ADD_USER_${chatIdStr}`),
                Markup.button.callback("➖ Remove user", `SET_${key.toUpperCase()}_REMOVE_USER_${chatIdStr}`)
            ]);

            // View users
            rows.push([Markup.button.callback("👀 View users", `VIEW_${key.toUpperCase()}_USERS_${chatIdStr}`)]);

            // punishment rows
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("❗ Warn", `BLOCK_PUNISH_warn_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("❗ Kick", `BLOCK_PUNISH_kick_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);

            // bottom nav
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;

        case "botblock":
            title = "🤖 Bot block";
            body =
                `If you enable this feature, users will not be able to add bots to the group.\n` +
                `You can also choose a penalty for users who try to do it.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n`

            // punishment rows only (no add/remove/view)
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("❗ Warn", `BLOCK_PUNISH_warn_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("❗ Kick", `BLOCK_PUNISH_kick_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);

            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;

        case "joinblock":
            title = "👨🏼 Join block";
            body =
                `Give a penalty to users or bots that try to join the group.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n`

            // Only Off / Kick / Mute / Ban and nav
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("❗ Kick", `BLOCK_PUNISH_kick_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;

        case "leaveblock":
            title = "🚪 Leave block";
            body =
                `Ban for users who leave the group.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n`

            // Buttons: Off, Ban, Back, Main menu
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;

        case "joinleave":
            title = "🏃‍♂️ Join-Leave block";
            // check delete flag
            const delEnabled = !!block.delete_service_message;
            const delStatus = delEnabled ? "On ✅" : "Off ❌";

            body =
                `If a user leaves the group a few seconds after joining, the service message and the welcome message will be deleted.\n` +
                `You can also set a punishment for such users.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Delete messages: ${delStatus}\n`

            // Buttons: Delete message (shows status), Ban, Off, nav
            rows.push([
                Markup.button.callback(`🗑️ Delete message: ${delStatus}`, `BLOCK_ACTION_delete_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;

        case "multiple_joins":
            title = "👨‍👩‍👧‍👦 Multiple joins block";
            // dynamic threshold/window if present in block config; defaults as requested
            const threshold = Number(block.threshold) || 4;
            const windowSec = Number(block.window) || 2;

            body =
                `Give a penalty if ${threshold} users join the group within ${windowSec} seconds.\n\n` +
                `(These values are configurable.)\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n`

            // Buttons: Off, Mute, Ban, Set joins, Set time, nav
            rows.push([
                Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
                Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback(`👥 Set joins (${threshold})`, `SET_MULTIPLE_JOINS_SET_JOINS_${chatIdStr}`),
                Markup.button.callback(`⏱️ Set time (${windowSec}s)`, `SET_MULTIPLE_JOINS_SET_TIME_${chatIdStr}`)
            ]);
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
            break;

        default:
            title = "Unknown block";
            body = `Unknown block key: ${key}\n\n- Status: ${status}`;
            rows.push([
                Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]);
    }

    await safeEditOrSend(ctx, `<b>${title}</b>\n\n${body}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

async function resolveCandidate(ctx, candidate) {
    try {
        // 1) Forwarded user object => always store id (string). Do NOT try to store username.
        if (candidate && typeof candidate === "object" && candidate.id) {
            return { ok: true, value: String(candidate.id) };
        }

        if (!candidate || typeof candidate !== "string") {
            return { ok: false, error: "Invalid input type. Send a forwarded user, @username or numeric id." };
        }

        const v = candidate.trim();

        // 2) Numeric id (can be negative for channels/groups)
        if (/^-?\d+$/.test(v)) {
            try {
                // Validate the chat id exists
                await ctx.telegram.getChat(v);
                // store numeric id directly
                return { ok: true, value: String(v) };
            } catch (err) {
                return { ok: false, error: `Could not resolve chat id ${v}.` };
            }
        }

        // 3) Possible username (with or without @)
        const maybeUsername = v.startsWith("@") ? v.slice(1) : v;
        if (/^[A-Za-z0-9_]{5,32}$/.test(maybeUsername)) {
            try {
                return { ok: true, value: `@${maybeUsername}` };
            } catch (err) {
                return { ok: false, error: `Could not resolve username @${maybeUsername}.` };
            }
        }

        // 4) Not a number and not a valid username pattern
        return { ok: false, error: "Send a valid @username (5-32 chars) or numeric chat id, or forward a user's message." };
    } catch (err) {
        // unexpected
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

    // Open each block detail (generic)
    bot.action(/^OPEN_BLOCK_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // render appropriate detail
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("OPEN_BLOCK error:", err);
        }
    });

    // View users list
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

            // format list (send all; consider pagination later)
            const listText = users.map((u, i) => `${i + 1}. ${u}`).join("\n");
            await safeEditOrSend(ctx, `<b>👥 ${key} users</b>\n\n${listText}`, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `OPEN_BLOCK_${key}_${chatIdStr}`)]] }
            });
        } catch (err) {
            console.error("VIEW_USERS error:", err);
        }
    });

    // Start Add user flow (store awaiting state in session)
    bot.action(/^SET_([A-Z_]+)_ADD_USER_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // put awaiting state in session (do not store in DB)
            ctx.session = ctx.session || {};
            ctx.session.blockAwait = {
                action: "add",
                key,
                chatIdStr,
                ownerId: userId,
                promptMessageId: null // will store bot prompt message id here
            };

            // prompt user
            const textMsg = `✍️ <b>Send now the user you want to ADD to <i>${key}</i>.</b>\n<i>You can send @username or numeric user id, or forward a user's message to add that user automatically.</i>`;
            const buttons = [
                [Markup.button.callback("❌ Cancel", `CANCEL_BLOCK_ADD_${key}_${chatIdStr}`)]
            ];

            await ctx.answerCbQuery("Send the user id or @username to add (in this chat).");

            // safeEditOrSend might return the sent/edited message. Capture message id if available.
            const botMsg = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons }
            });

            // try to save message id in session (best-effort)
            try {
                const msgId = botMsg?.message_id
                    || botMsg?.message?.message_id
                    || ctx.callbackQuery?.message?.message_id
                    || (ctx.message && ctx.message.message_id); // fallback
                if (msgId) ctx.session.blockAwait.promptMessageId = msgId;
            } catch (e) {
                // ignore; storing prompt id is best-effort
            }
        } catch (err) {
            console.error("SET_ADD_USER error:", err);
        }
    });

    // Cancel add flow via inline button (clears session)
    bot.action(/^CANCEL_BLOCK_ADD_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = ctx.session || {};
            // if there is a stored prompt message id, delete that bot message
            const promptId = ctx.session.blockAwait?.promptMessageId;
            if (promptId) {
                try { await ctx.deleteMessage(promptId); } catch (e) { /* ignore */ }
            }
            delete ctx.session.blockAwait;

            await ctx.answerCbQuery("Add operation cancelled.");
            // try to re-render block UI if we can infer key and chat from callback
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            await renderBlockDetail(ctx, chatIdStr, ctx.from.id, key);
        } catch (err) {
            console.error("CANCEL_BLOCK_ADD error:", err);
        }
    });

    // Start Remove user flow (store awaiting state in session)
    bot.action(/^SET_([A-Z_]+)_REMOVE_USER_(-?\d+)$/, async (ctx) => {
        try {
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.blockAwait = {
                action: "remove",
                key,
                chatIdStr,
                ownerId: userId,
                promptMessageId: null
            };

            const textMsg = `✍️ <b>Send now the user you want to REMOVE from <i>${key}</i>.</b>\n<i>You can send @username or numeric user id, or forward a user's message (from the target user) to remove them automatically.</i>`;
            const buttons = [
                [Markup.button.callback("❌ Cancel", `CANCEL_BLOCK_REMOVE_${key}_${chatIdStr}`)]
            ];

            await ctx.answerCbQuery("Send the user id or @username to remove (in this chat).");

            const botMsg = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons }
            });

            try {
                const msgId = botMsg?.message_id
                    || botMsg?.message?.message_id
                    || ctx.callbackQuery?.message?.message_id
                    || (ctx.message && ctx.message.message_id);
                if (msgId) ctx.session.blockAwait.promptMessageId = msgId;
            } catch (e) {
                // ignore
            }
        } catch (err) {
            console.error("SET_REMOVE_USER error:", err);
        }
    });

    // Cancel remove flow via inline button (clears session)
    bot.action(/^CANCEL_BLOCK_REMOVE_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = ctx.session || {};
            const promptId = ctx.session.blockAwait?.promptMessageId;
            if (promptId) {
                try { await ctx.deleteMessage(promptId); } catch (e) { /* ignore */ }
            }
            delete ctx.session.blockAwait;

            await ctx.answerCbQuery("Remove operation cancelled.");
            const key = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            await renderBlockDetail(ctx, chatIdStr, ctx.from.id, key);
        } catch (err) {
            console.error("CANCEL_BLOCK_REMOVE error:", err);
        }
    });

    // Punishment selection (generic for any block)
    bot.action(/^BLOCK_PUNISH_(off|warn|kick|mute|ban)_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const p = ctx.match[1]; // off|warn|kick|mute|ban
            const key = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const enable = p !== "off";

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: {
                        [`settings.${chatIdStr}.blocks.${key}.punishment`]: p,
                        [`settings.${chatIdStr}.blocks.${key}.enabled`]: enable
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

    // Generic block action handler (toggle delete service/welcome message)
    bot.action(/^BLOCK_ACTION_([a-z_]+)_([a-z_]+)_(-?\d+)$/, async (ctx) => {
        try {
            const actionName = ctx.match[1]; // e.g., "delete"
            const key = ctx.match[2];
            const chatIdStr = ctx.match[3];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            if (actionName === "delete") {
                // get current value
                const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const current = !!(userDoc?.settings?.[chatIdStr]?.blocks?.[key]?.delete_service_message);
                const newVal = !current;

                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.blocks.${key}.delete_service_message`]: newVal
                        }
                    },
                    { upsert: true }
                );

                await ctx.answerCbQuery(`Delete-on-quick-leave: ${newVal ? "On ✅" : "Off ❌"}`);
                await renderBlockDetail(ctx, chatIdStr, userId, key);
                return;
            }

            // fallback for other actions
            await ctx.answerCbQuery("Action saved.");
            await renderBlockDetail(ctx, chatIdStr, userId, key);
        } catch (err) {
            console.error("BLOCK_ACTION error:", err);
        }
    });

    // Placeholder handlers for multiple joins set buttons (you can implement dialogs/wizards as needed)
    bot.action(/^SET_MULTIPLE_JOINS_SET_JOINS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // start a session flow to set threshold (reuse the same blockAwait pattern)
            ctx.session = ctx.session || {};
            ctx.session.blockAwait = {
                action: "set_multiple_joins_joins",
                key: "multiple_joins",
                chatIdStr,
                ownerId: userId,
                promptMessageId: null
            };

            const textMsg = `✍️ <b>Send now the number of joins that should trigger the rule (e.g., 4).</b>`;
            const buttons = [[Markup.button.callback("❌ Cancel", `CANCEL_BLOCK_ADD_multiple_joins_${chatIdStr}`)]];

            const botMsg = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons }
            });

            try {
                const msgId = botMsg?.message_id || botMsg?.message?.message_id || ctx.callbackQuery?.message?.message_id;
                if (msgId) ctx.session.blockAwait.promptMessageId = msgId;
            } catch (e) { /* ignore */ }
        } catch (err) {
            console.error("SET_MULTIPLE_JOINS_SET_JOINS error:", err);
        }
    });

    bot.action(/^SET_MULTIPLE_JOINS_SET_TIME_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // start a session flow to set window seconds
            ctx.session = ctx.session || {};
            ctx.session.blockAwait = {
                action: "set_multiple_joins_time",
                key: "multiple_joins",
                chatIdStr,
                ownerId: userId,
                promptMessageId: null
            };

            const textMsg = `✍️ <b>Send now the time window in seconds (e.g., 2).</b>`;
            const buttons = [[Markup.button.callback("❌ Cancel", `CANCEL_BLOCK_ADD_multiple_joins_${chatIdStr}`)]];

            const botMsg = await safeEditOrSend(ctx, textMsg, {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons }
            });

            try {
                const msgId = botMsg?.message_id || botMsg?.message?.message_id || ctx.callbackQuery?.message?.message_id;
                if (msgId) ctx.session.blockAwait.promptMessageId = msgId;
            } catch (e) { /* ignore */ }
        } catch (err) {
            console.error("SET_MULTIPLE_JOINS_SET_TIME error:", err);
        }
    });

    // ---------------------------
    // Message listener: uses ctx.session.blockAwait + validation
    // ---------------------------
    bot.on('message', async (ctx) => {
        try {
            ctx.session = ctx.session || {};
            const awaitObj = ctx.session.blockAwait;
            if (!awaitObj) return;

            const { action, key, chatIdStr, ownerId } = awaitObj;
            const senderId = ctx.from?.id;
            if (!senderId) return;

            if (Number(ownerId) !== Number(senderId)) return;

            // delete the bot prompt message (if stored) before processing user's response
            const promptId = ctx.session.blockAwait?.promptMessageId;
            if (promptId) {
                try { await ctx.deleteMessage(promptId); } catch (e) { /* ignore errors */ }
                // clear prompt id so we don't try again
                delete ctx.session.blockAwait.promptMessageId;
            }

            // handle special flows for multiple_joins set values
            if (action === "set_multiple_joins_joins" && key === "multiple_joins") {
                // expecting a number in message text
                const num = Number(ctx.message.text?.trim());
                if (!num || num < 1) {
                    await ctx.reply("Please send a valid positive integer for joins. Try again or press Cancel.");
                    return;
                }

                await user_setting_module.updateOne(
                    { user_id: ownerId },
                    {
                        $setOnInsert: { user_id: ownerId },
                        $set: {
                            [`settings.${chatIdStr}.blocks.multiple_joins.threshold`]: num
                        }
                    },
                    { upsert: true }
                );

                delete ctx.session.blockAwait;
                await ctx.reply(`✅ Multiple joins threshold set to ${num}.`);
                try { await renderBlockDetail(ctx, chatIdStr, ownerId, "multiple_joins"); } catch (e) { }
                return;
            }

            if (action === "set_multiple_joins_time" && key === "multiple_joins") {
                const num = Number(ctx.message.text?.trim());
                if (!num || num < 1) {
                    await ctx.reply("Please send a valid positive integer for seconds. Try again or press Cancel.");
                    return;
                }

                await user_setting_module.updateOne(
                    { user_id: ownerId },
                    {
                        $setOnInsert: { user_id: ownerId },
                        $set: {
                            [`settings.${chatIdStr}.blocks.multiple_joins.window`]: num
                        }
                    },
                    { upsert: true }
                );

                delete ctx.session.blockAwait;
                await ctx.reply(`✅ Multiple joins window set to ${num} seconds.`);
                try { await renderBlockDetail(ctx, chatIdStr, ownerId, "multiple_joins"); } catch (e) { }
                return;
            }

            // derive raw candidate from message for add/remove and other generic flows
            let rawCandidate = null;
            if (ctx.message.forward_from) {
                rawCandidate = ctx.message.forward_from; // user object
            } else if (ctx.message.forward_from_chat) {
                rawCandidate = String(ctx.message.forward_from_chat.id);
            } else if (ctx.message.text) {
                rawCandidate = ctx.message.text.trim();
            } else if (ctx.message.caption) {
                rawCandidate = ctx.message.caption.trim();
            }

            if (!rawCandidate) {
                await ctx.reply("No valid user id / username / forwarded message detected. Please forward a user's message or send @username / user id.");
                return;
            }

            // resolve & validate
            const resolved = await resolveCandidate(ctx, rawCandidate);
            if (!resolved.ok) {
                // give the error and ask to resend (do not clear session)
                await ctx.reply(`${resolved.error} Please try again or press Cancel.`);
                return;
            }

            const value = resolved.value; // either "@username" or "123456..."

            if (action === 'add') {
                await user_setting_module.updateOne(
                    { user_id: ownerId },
                    {
                        $setOnInsert: { user_id: ownerId },
                        $addToSet: { [`settings.${chatIdStr}.blocks.${key}.users`]: value }
                    },
                    { upsert: true }
                );

                // clear session awaiting
                delete ctx.session.blockAwait;

                await ctx.reply(`✅ Added \`${value}\` to ${key}.`, { parse_mode: "Markdown" });

                try { await renderBlockDetail(ctx, chatIdStr, ownerId, key); } catch (e) { }
                return;
            }

            if (action === 'remove') {
                await user_setting_module.updateOne(
                    { user_id: ownerId },
                    {
                        $pull: { [`settings.${chatIdStr}.blocks.${key}.users`]: value }
                    }
                );

                delete ctx.session.blockAwait;

                await ctx.reply(`✅ Removed \`${value}\` from ${key} (if present).`, { parse_mode: "Markdown" });

                try { await renderBlockDetail(ctx, chatIdStr, ownerId, key); } catch (e) { }
                return;
            }
        } catch (err) {
            console.error("blocks_menu message handler error:", err);
        }
    });
};
