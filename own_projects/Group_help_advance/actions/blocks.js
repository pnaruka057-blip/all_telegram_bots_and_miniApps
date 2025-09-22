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

// generic detail renderer for each block key
async function renderBlockDetail(ctx, chatIdStr, userId, key) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const block = userDoc?.settings?.[chatIdStr]?.blocks?.[key] || {};

    const enabled = !!block.enabled;
    const status = enabled ? "On ✅" : "Off ❌";
    const punishment = block.punishment || "off";
    const users = Array.isArray(block.users) ? block.users : [];

    let title = "";
    let body = "";

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
            break;

        case "botblock":
            title = "🤖 Bot block";
            body =
                `If active, new bots will be prevented from joining the group or their messages will be removed.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Entries: ${users.length}`;
            break;

        case "joinblock":
            title = "🙂 Join block";
            body =
                `When enabled, join events can be blocked or restricted.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Entries: ${users.length}`;
            break;

        case "leaveblock":
            title = "📕 Leave block";
            body =
                `If enabled, leaving messages or frequent leaving/returning users can be restricted or monitored.\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Entries: ${users.length}`;
            break;

        case "joinleave":
            title = "🏃‍♂️ Join-Leave block";
            body =
                `This blocks users who repeatedly join and then immediately leave (or vice versa).\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Entries: ${users.length}`;
            break;

        case "multiple_joins":
            title = "👥 Multiple joins block";
            body =
                `Blocks or throttles multiple simultaneous joins (e.g., burst joining by many accounts).\n\n` +
                `- Status: ${status}\n` +
                `- Punishment: ${punishment.toUpperCase()}\n` +
                `- Entries: ${users.length}`;
            break;

        default:
            title = "Unknown block";
            body = `Unknown block key: ${key}\n\n- Status: ${status}`;
    }

    // build keyboard rows
    const rows = [];

    // Manage Users row
    rows.push([
        Markup.button.callback("➕ Add user", `SET_${key.toUpperCase()}_ADD_USER_${chatIdStr}`),
        Markup.button.callback("➖ Remove user", `SET_${key.toUpperCase()}_REMOVE_USER_${chatIdStr}`)
    ]);

    // View users
    rows.push([Markup.button.callback("👀 View users", `VIEW_${key.toUpperCase()}_USERS_${chatIdStr}`)]);

    // Punishment selection rows (two rows as required)
    rows.push([
        Markup.button.callback("❌ Off", `BLOCK_PUNISH_off_${key}_${chatIdStr}`),
        Markup.button.callback("❗ Warn", `BLOCK_PUNISH_warn_${key}_${chatIdStr}`)
    ]);
    rows.push([
        Markup.button.callback("❗ Kick", `BLOCK_PUNISH_kick_${key}_${chatIdStr}`),
        Markup.button.callback("🔕 Mute", `BLOCK_PUNISH_mute_${key}_${chatIdStr}`),
        Markup.button.callback("⛔ Ban", `BLOCK_PUNISH_ban_${key}_${chatIdStr}`)
    ]);

    // Bottom nav
    rows.push([
        Markup.button.callback("⬅️ Back", `SET_BLOCKS_${chatIdStr}`),
        Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
    ]);

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

            // derive raw candidate from message
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
