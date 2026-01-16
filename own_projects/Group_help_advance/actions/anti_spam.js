// handlers/antispam_tglinks.js
const { Markup, Input } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const parseDurationToSeconds = require('../helpers/parseDurationToSeconds');
const validate_telegram_link_or_username = require('../helpers/validate_telegram_link_or_username');
const path = require("path");

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

module.exports = (bot) => {
    bot.action(/SET_ANTISPAM_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            ctx.session = {};

            const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!isOwner) return;

            const text =
                `<b>🛡 Anti-Spam</b>\n\n` +
                `In this menu you can decide whether to protect your groups from unnecessary links, forwards, and quotes.\n\n` +
                `<i>Choose a category below to configure its settings:</i>`;

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("📘 Telegram links / username", `ANTISPAM_TGLINKS_${chatIdStr}`)],
                [
                    Markup.button.callback("📩 Forwarding", `ANTISPAM_FORWARD_${chatIdStr}`),
                    Markup.button.callback("☁️ Quote", `ANTISPAM_QUOTE_${chatIdStr}`)
                ],
                [Markup.button.callback("🔗 Total links block", `ANTISPAM_BLOCK_${chatIdStr}`)],
                [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
            ]);

            await safeEditOrSend(ctx, text, {
                parse_mode: "HTML",
                reply_markup: keyboard.reply_markup
            });
        } catch (err) {
            console.error("Error in SET_ANTISPAM handler:", err);
            try {
                await ctx.answerCbQuery("⚠️ Error while loading anti-spam menu.");
            } catch (e) {
                // ignore callback query answer errors
            }
        }
    });

    //#region TG_links

    async function renderTgLinksMenu(ctx, chatIdStr, userId, isOwner) {
        // fetch settings
        const userSettings = await user_setting_module.findOne({ user_id: userId }).lean();
        const tgLinks = userSettings?.settings?.[chatIdStr]?.anti_spam?.telegram_links || {};

        const penalty = (tgLinks.penalty || "off").toLowerCase();
        const penaltyLabel = penalty.charAt(0).toUpperCase() + penalty.slice(1);

        const deleteMessages = tgLinks.delete_messages ? "✓" : "✗";
        const usernameAntispam = tgLinks.username_antispam ? "✓" : "✗";

        // unified duration fields (fallback to legacy keys)
        const penaltyDurationStr = tgLinks.penalty_duration_str
            || tgLinks.warn_duration_str
            || tgLinks.mute_duration_str
            || tgLinks.ban_duration_str
            || "None";

        // build keyboard rows
        const rows = [
            [
                Markup.button.callback("❌ Off", `TGLINKS_OFF_${chatIdStr}`),
                Markup.button.callback("⚠ Warn", `TGLINKS_WARN_${chatIdStr}`),
                Markup.button.callback("🚪 Kick", `TGLINKS_KICK_${chatIdStr}`)
            ],
            [
                Markup.button.callback("🔇 Mute", `TGLINKS_MUTE_${chatIdStr}`),
                Markup.button.callback("⛔ Ban", `TGLINKS_BAN_${chatIdStr}`)
            ],
            [Markup.button.callback(`🗑 Delete Messages ${deleteMessages}`, `TGLINKS_DELETE_${chatIdStr}`)]
        ];

        // Conditional Set Duration button
        if (penalty === "warn") {
            rows.push([Markup.button.callback(`⏲️ Set Warn Duration (${penaltyDurationStr})`, `TGLINKS_SET_WARN_DURATION_${chatIdStr}`)]);
        } else if (penalty === "mute") {
            rows.push([Markup.button.callback(`⏲️ Set Mute Duration (${penaltyDurationStr})`, `TGLINKS_SET_MUTE_DURATION_${chatIdStr}`)]);
        } else if (penalty === "ban") {
            rows.push([Markup.button.callback(`⏲️ Set Ban Duration (${penaltyDurationStr})`, `TGLINKS_SET_BAN_DURATION_${chatIdStr}`)]);
        }

        // username antispam row
        rows.push([Markup.button.callback(`🎯 Username Antispam ${usernameAntispam}`, `TGLINKS_USERNAME_${chatIdStr}`)]);

        // exceptions + nav
        rows.push([Markup.button.callback("🌟 Exceptions", `TGLINKS_EXCEPTIONS_${chatIdStr}`)]);
        rows.push([
            Markup.button.callback("⬅️ Back", `SET_ANTISPAM_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]);

        const keyboard = Markup.inlineKeyboard(rows);

        // build text: show duration and permanence note ONLY for warn/mute/ban
        let text =
            `<b>📘 Telegram links / username</b>\n\n` +
            "This menu lets you control how Telegram links / username (users, channels, groups, bots) are handled.\n\n" +
            "⚙️ <b>How it works:</b>\n" +
            "• If a user sends any Telegram link (User / Channel / Group / Bot)\n" +
            "the selected <b>Penalty</b> will be applied.\n\n" +
            "• If <b>Deletion</b> is ON\n" +
            "the message will also be deleted.\n\n" +
            "• If <b>Username</b> is ON\n" +
            "usernames (like <code>@example</code>) are also checked and punished using the same <b>Penalty</b>. If <b>Deletion</b> is ON, such messages are also deleted.\n\n" +
            "• If <b>Penalty</b> is OFF but <b>Deletion</b> is ON\n" +
            "only the message is deleted (no punishment).\n\n" +
            `<b>Penalty:</b> ${penaltyLabel}\n` +
            `<b>Deletion:</b> ${deleteMessages === '✓' ? 'On ✅' : 'Off ❌'}\n` +
            `<b>Username:</b> ${usernameAntispam === '✓' ? 'On ✅' : 'Off ❌'}\n\n`;

        if (["warn", "mute", "ban"].includes(penalty)) {
            text += `<b>Penalty duration:</b> ${penaltyDurationStr}\n\n`;
            text += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n\n`;
        }

        text += `<i>👉 Use the buttons below to control this setting for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`;

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        });
    }

    // open tg links menu
    bot.action(/ANTISPAM_TGLINKS_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!isOwner) {
            return ctx.answerCbQuery("❌ You are not authorized to access Telegram links settings.", { show_alert: true });
        }

        await renderTgLinksMenu(ctx, chatIdStr, userId, isOwner);
    });

    // PENALTY SETTER
    bot.action(/TGLINKS_(OFF|WARN|KICK|MUTE|BAN)_(.+)/, async (ctx) => {
        const [, action, chatIdStr] = ctx.match;
        const userId = ctx.from.id;
        const chatId = Number(chatIdStr);

        const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!isOwner) return;

        // ✅ Set default duration ONLY if it doesn't exist (no overwrite on every penalty change)
        await user_setting_module.updateOne(
            {
                user_id: userId,
                $or: [
                    { [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration_str`]: { $exists: false } },
                    { [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration_str`]: null },
                    { [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration_str`]: "" },
                ],
            },
            {
                $set: {
                    [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration_str`]: "10 minutes",
                    [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration`]: 600000,
                },
            },
            { upsert: true }
        );

        // Now set the penalty action as usual
        await user_setting_module.findOneAndUpdate(
            { user_id: userId },
            {
                $set: {
                    [`settings.${chatIdStr}.anti_spam.telegram_links.penalty`]: action.toLowerCase(),
                },
            },
            { upsert: true, setDefaultsOnInsert: true }
        );

        await ctx.answerCbQuery(`✅ Penalty set to: ${action}`);
        await renderTgLinksMenu(ctx, chatIdStr, userId, isOwner);
    });

    // DELETE MESSAGES toggle
    bot.action(/TGLINKS_DELETE_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const chatId = Number(chatIdStr);

        const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!isOwner) return;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const currentValue = userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links?.delete_messages || false;
        const newValue = !currentValue;

        await user_setting_module.findOneAndUpdate(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.anti_spam.telegram_links.delete_messages`]: newValue } },
            { upsert: true }
        );

        await ctx.answerCbQuery(`🗑 Delete Messages ${newValue ? "enabled ✓" : "disabled ✗"}`);
        await renderTgLinksMenu(ctx, chatIdStr, userId, isOwner);
    });

    // USERNAME ANTI-SPAM toggle
    bot.action(/TGLINKS_USERNAME_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const chatId = Number(chatIdStr);

        const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!isOwner) return;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const currentValue = userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links?.username_antispam || false;
        const newValue = !currentValue;

        await user_setting_module.findOneAndUpdate(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.anti_spam.telegram_links.username_antispam`]: newValue } },
            { upsert: true }
        );

        await ctx.answerCbQuery(`🎯 Username Antispam ${newValue ? "enabled ✔" : "disabled ✗"}`);
        await renderTgLinksMenu(ctx, chatIdStr, userId, isOwner);
    });

    // Exceptions menu
    bot.action(/TGLINKS_EXCEPTIONS_(.+)/, async (ctx) => {
        ctx.session = {}
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        if (!(await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId))) return;

        const keyboard = {
            inline_keyboard: [
                [{ text: "🔠 Show Whitelist", callback_data: `TGLINKS_SHOWWL_${chatIdStr}` }],
                [
                    { text: "➕ Add", callback_data: `TGLINKS_ADDWL_${chatIdStr}` },
                    { text: "➖ Remove", callback_data: `TGLINKS_REMOVEWL_${chatIdStr}` }
                ],
                [
                    { text: "⬅️ Back", callback_data: `ANTISPAM_TGLINKS_${chatIdStr}` },
                    { text: "🏠 Main Menu", callback_data: `GROUP_SETTINGS_${chatIdStr}` }
                ]
            ]
        };

        const text =
            `🌟 <b>Antispam Exception</b>\n\n` +
            `Manage the Telegram links or usernames of users/bots/channels/groups that should not be treated as spam.\n\n` +
            `Any telegram links or usernames you add here will be <b>allowed in the group</b>, and the bot will not block or treat them as spam.\n\n` +
            `ℹ️ Group invite links are automatically added to the exception list.`;

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard
        });
    });

    // SHOW / ADD / REMOVE whitelist handlers (unchanged)
    bot.action(/TGLINKS_SHOWWL_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const whitelist = userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links?.whitelist || [];

        const escapeHTML = (s = "") => String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const listText = whitelist.length > 0
            ? whitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
            : "⚠️ Whitelist is currently empty.";

        const text = `🔠 <b>Whitelist</b>\n\n${listText}`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "⬅️ Back", callback_data: `TGLINKS_EXCEPTIONS_${chatIdStr}` },
                    { text: "🏠 Main Menu", callback_data: `GROUP_SETTINGS_${chatIdStr}` }
                ]
            ]
        };

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard
        });
    });

    bot.action(/TGLINKS_ADDWL_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➕ <b>Add to Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, to add them to the whitelist.\n\n" +
            "👉 Send each link/username on a new line (without extra symbols) you want to add.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram links : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n"

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `TGLINKS_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        // initialize session entry without promptMessage first
        ctx.session.awaitingWhitelistAdd = { chatIdStr, userId, promptMessage: null };

        // send the prompt (safeEditOrSend may return the sent/edited message)
        const sent = await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        }, true);

        // best-effort capture of chatId/messageId and store into session
        let promptChatId = null;
        let promptMsgId = null;

        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        } else if (ctx.chat && ctx.updateType === "callback_query" && ctx.callbackQuery && ctx.callbackQuery.message) {
            // fallback (redundant but safe)
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }

        if (ctx.session && ctx.session.awaitingWhitelistAdd) {
            ctx.session.awaitingWhitelistAdd.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
    });

    bot.action(/TGLINKS_REMOVEWL_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➖ <b>Remove from Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, to remove them from the whitelist.\n\n" +
            "👉 Send each link/username on a new line (without extra symbols) you want to remove.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram links : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n"

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `TGLINKS_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingWhitelistRemove = { chatIdStr, userId, promptMessage: null };

        const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });

        // capture prompt message (best-effort)
        let promptChatId = null;
        let promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }

        if (ctx.session && ctx.session.awaitingWhitelistRemove) {
            ctx.session.awaitingWhitelistRemove.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
    });

    // --- SET WARN / MUTE / BAN DURATION (show prompt) for TGLINKS ---
    // WARN
    bot.action(/TGLINKS_SET_WARN_DURATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingTgLinksWarnDuration = { chatIdStr, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.telegram_links || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for WARN penalty</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `TGLINKS_REMOVE_PUNISHMENT_DURATION${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `TGLINKS_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingTgLinksWarnDuration) {
                ctx.session.awaitingTgLinksWarnDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("TGLINKS_SET_WARN_DURATION action error:", err);
        }
    });

    // MUTE
    bot.action(/TGLINKS_SET_MUTE_DURATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingTgLinksMuteDuration = { chatIdStr, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.telegram_links || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for MUTE penalty</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `TGLINKS_REMOVE_PUNISHMENT_DURATION${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `TGLINKS_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingTgLinksMuteDuration) {
                ctx.session.awaitingTgLinksMuteDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("TGLINKS_SET_MUTE_DURATION action error:", err);
        }
    });

    // BAN
    bot.action(/TGLINKS_SET_BAN_DURATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingTgLinksBanDuration = { chatIdStr, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.telegram_links || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for BAN penalty</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `TGLINKS_REMOVE_PUNISHMENT_DURATION${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `TGLINKS_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingTgLinksBanDuration) {
                ctx.session.awaitingTgLinksBanDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("TGLINKS_SET_BAN_DURATION action error:", err);
        }
    });

    // --- REMOVE unified punishment duration (used by all three prompt screens) ---
    bot.action(/TGLINKS_REMOVE_PUNISHMENT_DURATION(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // unset unified fields (do NOT touch legacy separate fields)
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration_str`]: "",
                        [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration`]: ""
                    }
                },
                { upsert: true }
            );

            // clear any awaiting sessions
            if (ctx.session) {
                delete ctx.session.awaitingTgLinksWarnDuration;
                delete ctx.session.awaitingTgLinksMuteDuration;
                delete ctx.session.awaitingTgLinksBanDuration;
            }

            await ctx.answerCbQuery("Punishment duration removed.");
            await renderTgLinksMenu(ctx, chatIdStr, userId, await validateOwner(ctx, chatId, chatIdStr, userId));
        } catch (err) {
            console.error("TGLINKS_REMOVE_PUNISHMENT error:", err);
        }
    });

    // --- CANCEL SET (shared cancel for warn/mute/ban) ---
    bot.action(/TGLINKS_CANCEL_SET_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            // delete prompt message if stored in any of the sessions
            const sessionWarn = ctx.session?.awaitingTgLinksWarnDuration;
            const sessionMute = ctx.session?.awaitingTgLinksMuteDuration;
            const sessionBan = ctx.session?.awaitingTgLinksBanDuration;

            const session = sessionWarn || sessionMute || sessionBan;
            if (session && session.promptMessage) {
                try { await bot.telegram.deleteMessage(session.promptMessage.chatId, session.promptMessage.messageId); } catch (_) { /* ignore */ }
            }

            // clear all three possible sessions
            if (ctx.session) {
                delete ctx.session.awaitingTgLinksWarnDuration;
                delete ctx.session.awaitingTgLinksMuteDuration;
                delete ctx.session.awaitingTgLinksBanDuration;
            }

            await ctx.answerCbQuery("Cancelled.");
            await renderTgLinksMenu(ctx, chatIdStr, userId, await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId));
        } catch (err) {
            console.error("TGLINKS_CANCEL_SET error:", err);
        }
    });

    //#endregion TG_links


    //#region Forward

    async function renderForwardMainMenu(ctx, chatIdStr) {
        const userId = ctx.from.id;
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const forward = userDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding || {};

        const getLabel = (obj) => {
            const penalty = (obj?.penalty || "off");
            const penaltyLabel = capitalize(penalty);
            const del = obj?.delete_messages ? "Yes ✅" : "No ❌";
            return `${penaltyLabel} · Delete: ${del}`;
        };

        const channelsLabel = getLabel(forward.channels);
        const groupsLabel = getLabel(forward.groups);
        const usersLabel = getLabel(forward.users);
        const botsLabel = getLabel(forward.bots);

        const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!isOwner) return;

        const text =
            `📨 <b>Forwarding</b>\n\n` +
            `Select penalty for users who forward messages in the group.\n\n` +
            `<b>Current settings:</b>\n` +
            `📣 Channels: <code>${channelsLabel}</code>\n` +
            `👥 Groups: <code>${groupsLabel}</code>\n` +
            `👤 Users: <code>${usersLabel}</code>\n` +
            `🤖 Bots: <code>${botsLabel}</code>\n\n` +
            `<i>👉 Choose which source you want to configure for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("📣 Channels", `FORWARD_CHANNELS_${chatIdStr}`),
                Markup.button.callback("👥 Groups", `FORWARD_GROUPS_${chatIdStr}`)
            ],
            [
                Markup.button.callback("👤 Users", `FORWARD_USERS_${chatIdStr}`),
                Markup.button.callback("🤖 Bots", `FORWARD_BOTS_${chatIdStr}`)
            ],
            [
                Markup.button.callback("🌟 Exceptions", `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}`)
            ],
            [
                Markup.button.callback("⬅️ Back", `SET_ANTISPAM_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]
        ]);

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
    }

    // render Forward target menu (updated: shows current penalty duration & Set button)
    async function renderForwardTargetMenu(ctx, chatIdStr, target) {
        const userId = ctx.from.id;
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const tg = userDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.[target] || {};

        const penalty = (tg.penalty || "off").toLowerCase();
        const penaltyLabel = capitalize(penalty);
        const deleteMessages = tg.delete_messages ? "Yes ✅" : "No ❌";

        // unified per-target duration field name (with legacy fallbacks)
        const penaltyDurationStr = tg.penalty_duration_str
            || tg.warn_duration_str
            || tg.mute_duration_str
            || tg.ban_duration_str
            || "None";

        // Build base text first (without unconditional duration)
        let text =
            `⚙️ <b>Forward from ${capitalize(target)}</b>\n\n` +
            `Choose the penalty applied when someone forwards messages from <b>${capitalize(target)}</b>.\n\n` +
            `<b>Penalty</b>: ${penaltyLabel}\n` +
            `<b>Delete messages</b>: ${deleteMessages}\n`;

        // Show duration and permanence note ONLY for warn/mute/ban
        if (["warn", "mute", "ban"].includes(penalty)) {
            text += `<b>Penalty duration</b>: ${penaltyDurationStr}\n\n`;
            text += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n\n`;
        } else {
            text += `\n`;
        }

        text += `<i>Select a penalty below:</i>`;

        const rows = [
            [
                Markup.button.callback("❌ Off", `PUNISH_OFF_${chatIdStr}_${target}`),
                Markup.button.callback("❗ Warn", `PUNISH_WARN_${chatIdStr}_${target}`),
                Markup.button.callback("❕ Kick", `PUNISH_KICK_${chatIdStr}_${target}`)
            ],
            [
                Markup.button.callback("🔇 Mute", `PUNISH_MUTE_${chatIdStr}_${target}`),
                Markup.button.callback("⛔ Ban", `PUNISH_BAN_${chatIdStr}_${target}`)
            ],
            [
                Markup.button.callback(
                    `${tg.delete_messages ? "🗑️ Delete Messages ✓" : "🗑️ Delete Messages ✗"}`,
                    `PUNISH_TOGGLE_DELETE_${chatIdStr}_${target}`
                )
            ]
        ];

        // Add set-duration button conditionally
        if (penalty === "warn") {
            rows.push([Markup.button.callback(`⏲️ Set Warn Duration (${penaltyDurationStr})`, `FORWARD_SET_WARN_DURATION_${chatIdStr}_${target}`)]);
        } else if (penalty === "mute") {
            rows.push([Markup.button.callback(`⏲️ Set Mute Duration (${penaltyDurationStr})`, `FORWARD_SET_MUTE_DURATION_${chatIdStr}_${target}`)]);
        } else if (penalty === "ban") {
            rows.push([Markup.button.callback(`⏲️ Set Ban Duration (${penaltyDurationStr})`, `FORWARD_SET_BAN_DURATION_${chatIdStr}_${target}`)]);
        }

        // navigation
        rows.push([
            Markup.button.callback("⬅️ Back", `ANTISPAM_FORWARD_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]);

        const keyboard = Markup.inlineKeyboard(rows);

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
    }

    // --- SHOW/HANDLERS for forwarding menus (unchanged) ---
    bot.action(/^ANTISPAM_FORWARD_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            await renderForwardMainMenu(ctx, chatIdStr);
        } catch (err) {
            console.error("Error in ANTISPAM_FORWARD action:", err);
        }
    });

    bot.action(/^FORWARD_(CHANNELS|GROUPS|USERS|BOTS)_(.+)/, async (ctx) => {
        try {
            const target = ctx.match[1].toLowerCase();
            const realChatIdStr = ctx.match[2] || ctx.match[1];

            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(realChatIdStr), realChatIdStr, userId);
            if (!chat) return;

            await renderForwardTargetMenu(ctx, realChatIdStr, target);
        } catch (err) {
            console.error("Error in FORWARD_* handler:", err);
        }
    });

    // PUNISH for forwarding targets (sets penalty)
    bot.action(/^PUNISH_(OFF|WARN|KICK|MUTE|BAN)_(.+)_(channels|groups|users|bots)/i, async (ctx) => {
        try {
            const action = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const target = ctx.match[3].toLowerCase();
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            // ✅ Set default duration ONLY if missing/empty (no overwrite on every penalty change)
            await user_setting_module.updateOne(
                {
                    user_id: userId,
                    $or: [
                        { [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration_str`]: { $exists: false } },
                        { [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration_str`]: null },
                        { [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration_str`]: "" },
                    ],
                },
                {
                    $set: {
                        [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration_str`]: "10 minutes",
                        [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration`]: 600000,
                    },
                },
                { upsert: true }
            );

            // Set the penalty
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty`]: action,
                    },
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`✅ Penalty for ${capitalize(target)} set to ${capitalize(action)}`);
            await renderForwardTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("Error in PUNISH_* handler:", err);
        }
    });

    bot.action(/^PUNISH_TOGGLE_DELETE_(.+)_(channels|groups|users|bots)/i, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = !!userDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.[target]?.delete_messages;

            const newVal = !current;
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.anti_spam.forwarding.${target}.delete_messages`]: newVal
                    }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`🗑 Delete messages for ${capitalize(target)} ${newVal ? "enabled ✔" : "disabled ✖"}`);
            await renderForwardTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("Error in PUNISH_TOGGLE_DELETE handler:", err);
        }
    });

    // --- SET WARN / MUTE / BAN DURATION for forwarding targets (show prompt) ---
    // Forwards: WARN
    bot.action(/^FORWARD_SET_WARN_DURATION_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingForwardWarnDuration = { chatIdStr, target, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.[target] || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for WARN penalty (forward from ${capitalize(target)})</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `FORWARD_REMOVE_PUNISHMENT_${chatIdStr}_${target}`)],
                [Markup.button.callback("❌ Cancel", `FORWARD_CANCEL_SET_${chatIdStr}_${target}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingForwardWarnDuration) {
                ctx.session.awaitingForwardWarnDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("FORWARD_SET_WARN_DURATION action error:", err);
        }
    });

    // Forwards: MUTE
    bot.action(/^FORWARD_SET_MUTE_DURATION_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingForwardMuteDuration = { chatIdStr, target, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.[target] || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for MUTE penalty (forward from ${capitalize(target)})</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `FORWARD_REMOVE_PUNISHMENT_${chatIdStr}_${target}`)],
                [Markup.button.callback("❌ Cancel", `FORWARD_CANCEL_SET_${chatIdStr}_${target}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingForwardMuteDuration) {
                ctx.session.awaitingForwardMuteDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("FORWARD_SET_MUTE_DURATION action error:", err);
        }
    });

    // Forwards: BAN
    bot.action(/^FORWARD_SET_BAN_DURATION_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingForwardBanDuration = { chatIdStr, target, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.[target] || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for BAN penalty (forward from ${capitalize(target)})</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `FORWARD_REMOVE_PUNISHMENT_${chatIdStr}_${target}`)],
                [Markup.button.callback("❌ Cancel", `FORWARD_CANCEL_SET_${chatIdStr}_${target}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null;
            let promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            if (ctx.session && ctx.session.awaitingForwardBanDuration) {
                ctx.session.awaitingForwardBanDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
        } catch (err) {
            console.error("FORWARD_SET_BAN_DURATION action error:", err);
        }
    });

    // --- REMOVE unified punishment duration for forwarding target ---
    bot.action(/^FORWARD_REMOVE_PUNISHMENT_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration_str`]: "",
                        [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration`]: ""
                    }
                },
                { upsert: true }
            );

            if (ctx.session) {
                delete ctx.session.awaitingForwardWarnDuration;
                delete ctx.session.awaitingForwardMuteDuration;
                delete ctx.session.awaitingForwardBanDuration;
            }

            await ctx.answerCbQuery("Punishment duration removed for forwarding target.");
            await renderForwardTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("FORWARD_REMOVE_PUNISHMENT error:", err);
        }
    });

    // --- CANCEL SET for forwarding target ---
    bot.action(/^FORWARD_CANCEL_SET_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;

            // pick any session for this target
            const sWarn = ctx.session?.awaitingForwardWarnDuration;
            const sMute = ctx.session?.awaitingForwardMuteDuration;
            const sBan = ctx.session?.awaitingForwardBanDuration;
            const session = (sWarn && sWarn.target === target && sWarn.chatIdStr === chatIdStr) ? sWarn
                : (sMute && sMute.target === target && sMute.chatIdStr === chatIdStr) ? sMute
                    : (sBan && sBan.target === target && sBan.chatIdStr === chatIdStr) ? sBan
                        : null;

            if (session && session.promptMessage) {
                try { await bot.telegram.deleteMessage(session.promptMessage.chatId, session.promptMessage.messageId); } catch (_) { /* ignore */ }
            }

            if (ctx.session) {
                delete ctx.session.awaitingForwardWarnDuration;
                delete ctx.session.awaitingForwardMuteDuration;
                delete ctx.session.awaitingForwardBanDuration;
            }

            await ctx.answerCbQuery("Cancelled.");
            await renderForwardTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("FORWARD_CANCEL_SET error:", err);
        }
    });

    // -------------------------
    // FORWARDING EXCEPTIONS MENU (reworked to match Antispam exceptions behavior)
    // -------------------------
    bot.action(/^ANTISPAM_FORWARD_EXCEPTIONS_(-?\d+)$/, async (ctx) => {
        ctx.session = {}
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!chat) return;

        const text =
            `🌟 <b>Forward Antispam Exception</b>\n\n` +
            `Manage the Telegram links or usernames of users/bots/channels/groups whose forwarded messages will not be treated as spam.\n\n` +
            `Any telegram links or usernames you add here will be <b>allowed when forwarded</b> and the bot will not block forwarded messages coming from them.\n\n`

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔠 Show list", `ANTISPAM_FORWARD_EXCEPTIONS_SHOW_${chatIdStr}`)],
            [Markup.button.callback("➕ Add", `ANTISPAM_FORWARD_EXCEPTIONS_ADD_${chatIdStr}`), Markup.button.callback("➖ Remove", `ANTISPAM_FORWARD_EXCEPTIONS_REMOVE_${chatIdStr}`)],
            [Markup.button.callback("⬅️ Back", `ANTISPAM_FORWARD_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
        ]);

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
    });

    // SHOW forwarding whitelist
    bot.action(/^ANTISPAM_FORWARD_EXCEPTIONS_SHOW_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const whitelist = userSettings?.settings?.get(chatIdStr)?.anti_spam?.forwarding?.whitelist || [];

        const escapeHTML = (s = "") => String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const listText = whitelist.length > 0
            ? whitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
            : "⚠️ No exceptions added yet.";

        const text = `🌟 <b>Forward Exceptions List</b>\n\n${listText}`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "⬅️ Back", callback_data: `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}` },
                    { text: "🏠 Main Menu", callback_data: `GROUP_SETTINGS_${chatIdStr}` }
                ]
            ]
        };

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard
        });
    });

    // ADD prompt: store promptMessage in session
    bot.action(/^ANTISPAM_FORWARD_EXCEPTIONS_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➕ <b>Add to Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, or numeric IDs (user IDs or chat IDs like <code>-100...</code>) to add them to the whitelist.\n\n" +
            "👉 Send each link/username/ID on a new line (without extra symbols), or forward a message from the users/bots/channels/groups you want to add.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram link : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n" +
            "• User/bot ID : <code>123456789</code>\n" +
            "• Group/channel ID : <code>-1001234567890</code>";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingForwardAdd = { chatIdStr, userId, promptMessage: null };

        // send the prompt and capture returned message (best-effort)
        const sent = await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        }, true);

        let promptChatId = null;
        let promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }

        if (ctx.session && ctx.session.awaitingForwardAdd) {
            ctx.session.awaitingForwardAdd.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
    });

    // REMOVE prompt: store promptMessage in session
    bot.action(/^ANTISPAM_FORWARD_EXCEPTIONS_REMOVE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➖ <b>Remove from Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, or numeric IDs (user IDs or chat IDs like <code>-100...</code>) to remove them from the whitelist.\n\n" +
            "👉 Send each link/username/ID on a new line (without extra symbols), or forward a message from the users/bots/channels/groups you want to remove.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram link : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n" +
            "• User/bot ID : <code>123456789</code>\n" +
            "• Group/channel ID : <code>-1001234567890</code>";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingForwardRemove = { chatIdStr, userId, promptMessage: null };

        const sent = await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        }, true);

        let promptChatId = null;
        let promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }

        if (ctx.session && ctx.session.awaitingForwardRemove) {
            ctx.session.awaitingForwardRemove.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { /* ignore */ }
    });

    //#endregion Forward


    //#region Quote

    async function renderQuoteMainMenu(ctx, chatIdStr) {
        const userId = ctx.from.id;

        // load settings
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const quote = userDoc?.settings?.[chatIdStr]?.anti_spam?.quote || {};

        // same label style as Forwarding: "Penalty · Delete: Yes/No"
        const getLabel = (obj) => {
            const penalty = (obj?.penalty || "off");
            const penaltyLabel = capitalize(penalty);
            const del = obj?.delete_messages ? "Yes ✅" : "No ❌";
            return `${penaltyLabel} · Delete: ${del}`;
        };

        const channelsLabel = getLabel(quote.channels);
        const groupsLabel = getLabel(quote.groups);
        const usersLabel = getLabel(quote.users);
        const botsLabel = getLabel(quote.bots);

        // ownership check (same flow as Forwarding)
        const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!isOwner) return;

        const text =
            `☁ <b>Quote</b>\n\n` +
            `Select penalty for users who send messages containing quotes from external chats.\n\n` +
            `<b>Current settings:</b>\n` +
            `📣 Channels: <code>${channelsLabel}</code>\n` +
            `👥 Groups: <code>${groupsLabel}</code>\n` +
            `👤 Users: <code>${usersLabel}</code>\n` +
            `🤖 Bots: <code>${botsLabel}</code>\n\n` +
            `<i>👉 Choose which source to configure for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("📣 Channels", `QUOTE_CHANNELS_${chatIdStr}`),
                Markup.button.callback("👥 Groups", `QUOTE_GROUPS_${chatIdStr}`)
            ],
            [
                Markup.button.callback("👤 Users", `QUOTE_USERS_${chatIdStr}`),
                Markup.button.callback("🤖 Bots", `QUOTE_BOTS_${chatIdStr}`)
            ],
            [
                Markup.button.callback("🌟 Exceptions", `ANTISPAM_QUOTE_EXCEPTIONS_${chatIdStr}`)
            ],
            [
                Markup.button.callback("⬅️ Back", `SET_ANTISPAM_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]
        ]);

        const imagePath = path.resolve(__dirname, '..', 'public', 'images', 'quote_image.jpg');

        await safeEditOrSend(ctx, text, {
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup,
            show_caption_above_media: true,
            __asMedia: true,
            __media: {
                type: 'photo',
                media: Input.fromLocalFile(imagePath)
            }
        });
    }

    // Render Quote target menu (channels | groups | users | bots)
    async function renderQuoteTargetMenu(ctx, chatIdStr, target) {
        const userId = ctx.from.id;

        // read current settings for this chat and target
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const q = userDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.[target] || {};

        const penalty = (q.penalty || "off").toLowerCase();
        const penaltyLabel = capitalize(penalty);
        const deleteMessages = q.delete_messages ? "Yes ✅" : "No ❌";

        // unified duration string with legacy fallbacks
        const penaltyDurationStr =
            q.penalty_duration_str ||
            q.warn_duration_str ||
            q.mute_duration_str ||
            q.ban_duration_str ||
            "None";

        // Build base text (no unconditional duration)
        let text =
            `☁️ <b>Quote from ${capitalize(target)}</b>\n\n` +
            `Choose the penalty applied when someone sends a message that contains a quote from <b>${capitalize(target)}</b>.\n\n` +
            `<b>Penalty</b>: ${penaltyLabel}\n` +
            `<b>Delete messages</b>: ${deleteMessages}\n`;

        // Show duration and permanence note ONLY for warn/mute/ban
        if (["warn", "mute", "ban"].includes(penalty)) {
            text += `<b>Penalty duration</b>: ${penaltyDurationStr}\n\n`;
            text += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n\n`;
        } else {
            text += `\n`;
        }

        text += `<i>Select a penalty below:</i>`;

        const rows = [
            [
                Markup.button.callback("❌ Off", `QUOTE_PUNISH_OFF_${chatIdStr}_${target}`),
                Markup.button.callback("❗ Warn", `QUOTE_PUNISH_WARN_${chatIdStr}_${target}`),
                Markup.button.callback("❕ Kick", `QUOTE_PUNISH_KICK_${chatIdStr}_${target}`)
            ],
            [
                Markup.button.callback("🔇 Mute", `QUOTE_PUNISH_MUTE_${chatIdStr}_${target}`),
                Markup.button.callback("⛔ Ban", `QUOTE_PUNISH_BAN_${chatIdStr}_${target}`)
            ],
            [
                // keep same toggle callback shape as Forwarding for consistency
                Markup.button.callback(
                    `${q.delete_messages ? "🗑️ Delete Messages ✓" : "🗑️ Delete Messages ✗"}`,
                    `QUOTE_TOGGLE_DELETE_${chatIdStr}_${target}`
                )
            ]
        ];

        // quote-specific duration setters
        if (penalty === "warn") {
            rows.push([Markup.button.callback(`⏲️ Set Warn Duration (${penaltyDurationStr})`, `QUOTE_SET_WARN_DURATION_${chatIdStr}_${target}`)]);
        } else if (penalty === "mute") {
            rows.push([Markup.button.callback(`⏲️ Set Mute Duration (${penaltyDurationStr})`, `QUOTE_SET_MUTE_DURATION_${chatIdStr}_${target}`)]);
        } else if (penalty === "ban") {
            rows.push([Markup.button.callback(`⏲️ Set Ban Duration (${penaltyDurationStr})`, `QUOTE_SET_BAN_DURATION_${chatIdStr}_${target}`)]);
        }

        // navigation
        rows.push([
            Markup.button.callback("⬅️ Back", `ANTISPAM_QUOTE_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]);

        const keyboard = Markup.inlineKeyboard(rows);
        await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
    }

    // Open Quote main menu
    bot.action(/^ANTISPAM_QUOTE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        await renderQuoteMainMenu(ctx, chatIdStr);
    });

    // placeholders for per-source handlers (implement like Forwarding target menus)
    bot.action(/^QUOTE_(CHANNELS|GROUPS|USERS|BOTS)_(.+)/, async (ctx) => {
        const target = ctx.match[1].toLowerCase();
        const chatIdStr = ctx.match[2];
        await renderQuoteTargetMenu(ctx, chatIdStr, target);
    });

    // --- QUOTE: set penalty for targets ---
    bot.action(/^QUOTE_PUNISH_(OFF|WARN|KICK|MUTE|BAN)_(.+)_(channels|groups|users|bots)/i, async (ctx) => {
        try {
            const action = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const target = ctx.match[3].toLowerCase();
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            // ✅ Set default duration ONLY if missing/empty (no overwrite on every penalty change)
            await user_setting_module.updateOne(
                {
                    user_id: userId,
                    $or: [
                        { [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration_str`]: { $exists: false } },
                        { [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration_str`]: null },
                        { [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration_str`]: "" },
                    ],
                },
                {
                    $set: {
                        [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration_str`]: "10 minutes",
                        [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration`]: 600000,
                    },
                },
                { upsert: true }
            );

            // Set the penalty for quote target
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty`]: action } },
                { upsert: true }
            );

            await ctx.answerCbQuery(
                `✅ Penalty for ${target.charAt(0).toUpperCase() + target.slice(1)} set to ${action.charAt(0).toUpperCase() + action.slice(1)}`
            );
            await renderQuoteTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("Error in QUOTE_PUNISH_* handler:", err);
        }
    });

    // --- QUOTE: toggle delete_messages ---
    bot.action(/^QUOTE_TOGGLE_DELETE_(.+)_(channels|groups|users|bots)/i, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = !!userDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.[target]?.delete_messages;
            const newVal = !current;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.anti_spam.quote.${target}.delete_messages`]: newVal } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`🗑 Delete messages for ${target.charAt(0).toUpperCase() + target.slice(1)} ${newVal ? "enabled ✔" : "disabled ✖"}`);
            await renderQuoteTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("Error in QUOTE_TOGGLE_DELETE handler:", err);
        }
    });

    // --- QUOTE: prompt Set Warn/Mute/Ban duration ---
    bot.action(/^QUOTE_SET_WARN_DURATION_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingQuoteWarnDuration = { chatIdStr, target, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.[target] || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for WARN penalty (quote from ${target})</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `QUOTE_REMOVE_PUNISHMENT_${chatIdStr}_${target}`)],
                [Markup.button.callback("❌ Cancel", `QUOTE_CANCEL_SET_${chatIdStr}_${target}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }
            if (ctx.session && ctx.session.awaitingQuoteWarnDuration) {
                ctx.session.awaitingQuoteWarnDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("QUOTE_SET_WARN_DURATION action error:", err);
        }
    });

    bot.action(/^QUOTE_SET_MUTE_DURATION_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingQuoteMuteDuration = { chatIdStr, target, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.[target] || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for MUTE penalty (quote from ${target})</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `QUOTE_REMOVE_PUNISHMENT_${chatIdStr}_${target}`)],
                [Markup.button.callback("❌ Cancel", `QUOTE_CANCEL_SET_${chatIdStr}_${target}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }
            if (ctx.session && ctx.session.awaitingQuoteMuteDuration) {
                ctx.session.awaitingQuoteMuteDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("QUOTE_SET_MUTE_DURATION action error:", err);
        }
    });

    bot.action(/^QUOTE_SET_BAN_DURATION_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingQuoteBanDuration = { chatIdStr, target, userId, promptMessage: null };

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = userDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.[target] || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for BAN penalty (quote from ${target})</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `QUOTE_REMOVE_PUNISHMENT_${chatIdStr}_${target}`)],
                [Markup.button.callback("❌ Cancel", `QUOTE_CANCEL_SET_${chatIdStr}_${target}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }
            if (ctx.session && ctx.session.awaitingQuoteBanDuration) {
                ctx.session.awaitingQuoteBanDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("QUOTE_SET_BAN_DURATION action error:", err);
        }
    });

    // --- QUOTE: remove duration (unset fields) ---
    bot.action(/^QUOTE_REMOVE_PUNISHMENT_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration_str`]: "",
                        [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration`]: ""
                    }
                },
                { upsert: true }
            );

            if (ctx.session) {
                delete ctx.session.awaitingQuoteWarnDuration;
                delete ctx.session.awaitingQuoteMuteDuration;
                delete ctx.session.awaitingQuoteBanDuration;
            }

            await ctx.answerCbQuery("Punishment duration removed for quote target.");
            await renderQuoteTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("QUOTE_REMOVE_PUNISHMENT error:", err);
        }
    });

    // --- QUOTE: cancel set (cleanup prompt and sessions) ---
    bot.action(/^QUOTE_CANCEL_SET_(.+)_(channels|groups|users|bots)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const target = ctx.match[2].toLowerCase();
            const userId = ctx.from.id;

            const sWarn = ctx.session?.awaitingQuoteWarnDuration;
            const sMute = ctx.session?.awaitingQuoteMuteDuration;
            const sBan = ctx.session?.awaitingQuoteBanDuration;
            const session = (sWarn && sWarn.target === target && sWarn.chatIdStr === chatIdStr) ? sWarn
                : (sMute && sMute.target === target && sMute.chatIdStr === chatIdStr) ? sMute
                    : (sBan && sBan.target === target && sBan.chatIdStr === chatIdStr) ? sBan
                        : null;

            if (session && session.promptMessage) {
                try { await bot.telegram.deleteMessage(session.promptMessage.chatId, session.promptMessage.messageId); } catch (_) { }
            }

            if (ctx.session) {
                delete ctx.session.awaitingQuoteWarnDuration;
                delete ctx.session.awaitingQuoteMuteDuration;
                delete ctx.session.awaitingQuoteBanDuration;
            }

            await ctx.answerCbQuery("Cancelled.");
            await renderQuoteTargetMenu(ctx, chatIdStr, target);
        } catch (err) {
            console.error("QUOTE_CANCEL_SET error:", err);
        }
    });

    // Quote Exceptions menu (mirrors Forward Exceptions; wire to own whitelist path)
    bot.action(/^ANTISPAM_QUOTE_EXCEPTIONS_(-?\d+)$/, async (ctx) => {
        ctx.session = {};
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!chat) return;

        const text =
            `🌟 <b>Quote Antispam Exception</b>\n\n` +
            `Manage usernames/IDs/links whose quoted messages will be allowed without punishment.\n\n` +
            `Items added here are allowed when quoted and will not be treated as spam.`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔠 Show list", `ANTISPAM_QUOTE_EXCEPTIONS_SHOW_${chatIdStr}`)],
            [
                Markup.button.callback("➕ Add", `ANTISPAM_QUOTE_EXCEPTIONS_ADD_${chatIdStr}`),
                Markup.button.callback("➖ Remove", `ANTISPAM_QUOTE_EXCEPTIONS_REMOVE_${chatIdStr}`)
            ],
            [
                Markup.button.callback("⬅️ Back", `ANTISPAM_QUOTE_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]
        ]);

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", ...keyboard });
    });

    // SHOW quote whitelist
    bot.action(/^ANTISPAM_QUOTE_EXCEPTIONS_SHOW_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const whitelist =
            userSettings?.settings?.get(chatIdStr)?.anti_spam?.quote?.whitelist || [];

        const escapeHTML = (s = "") => String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        const listText = whitelist.length > 0
            ? whitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
            : "⚠️ No exceptions added yet.";

        const text = `🌟 <b>Quote Exceptions List</b>\n\n${listText}`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "⬅️ Back", callback_data: `ANTISPAM_QUOTE_EXCEPTIONS_${chatIdStr}` },
                    { text: "🏠 Main Menu", callback_data: `GROUP_SETTINGS_${chatIdStr}` }
                ]
            ]
        };

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard
        });
    });

    // ADD prompt: store promptMessage in session
    bot.action(/^ANTISPAM_QUOTE_EXCEPTIONS_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➕ <b>Add to Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, or numeric IDs (user IDs or chat IDs like <code>-100...</code>) to add them to the whitelist.\n\n" +
            "👉 Send each link/username/ID on a new line (without extra symbols), or forward a message from the users/bots/channels/groups you want to add.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram link : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n" +
            "• User/bot ID : <code>123456789</code>\n" +
            "• Group/channel ID : <code>-1001234567890</code>";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `ANTISPAM_QUOTE_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingQuoteAdd = { chatIdStr, userId, promptMessage: null };

        const sent = await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        }, true);

        let promptChatId = null;
        let promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }

        if (ctx.session && ctx.session.awaitingQuoteAdd) {
            ctx.session.awaitingQuoteAdd.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { }
    });

    // REMOVE prompt: store promptMessage in session
    bot.action(/^ANTISPAM_QUOTE_EXCEPTIONS_REMOVE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➖ <b>Remove from Quote Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, or numeric IDs (user IDs or chat IDs like <code>-100...</code>) to remove them from the whitelist.\n\n" +
            "👉 Send each link/username/ID on a new line (without extra symbols), or forward a message from the users/bots/channels/groups you want to remove.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram link : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n" +
            "• User/bot ID : <code>123456789</code>\n" +
            "• Group/channel ID : <code>-1001234567890</code>";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `ANTISPAM_QUOTE_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingQuoteRemove = { chatIdStr, userId, promptMessage: null };

        const sent = await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        }, true);

        let promptChatId = null;
        let promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }

        if (ctx.session && ctx.session.awaitingQuoteRemove) {
            ctx.session.awaitingQuoteRemove.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { }
    });

    //#endregion Quote


    //#region Total_links_block

    // Open "Total links block" main
    bot.action(/^ANTISPAM_BLOCK_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!isOwner) return;

            await renderLinksBlockMenu(ctx, chatIdStr, userId, isOwner);
        } catch (err) {
            console.error("Error in ANTISPAM_BLOCK action:", err);
        }
    });

    // Render "Total links block" menu
    async function renderLinksBlockMenu(ctx, chatIdStr, userId, isOwner) {
        const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
        const lb = userDoc?.settings?.[chatIdStr]?.anti_spam?.links_block || {};

        const penalty = (lb.penalty || "off").toLowerCase();
        const penaltyLabel = penalty.charAt(0).toUpperCase() + penalty.slice(1);
        const deleteMessages = lb.delete_messages ? "✓" : "✗";

        const penaltyDurationStr =
            lb.penalty_duration_str ||
            "None";

        const rows = [
            [
                Markup.button.callback("❌ Off", `ANTISPAM_BLOCK_PUNISH_OFF_${chatIdStr}`),
                Markup.button.callback("⚠ Warn", `ANTISPAM_BLOCK_PUNISH_WARN_${chatIdStr}`),
                Markup.button.callback("🚪 Kick", `ANTISPAM_BLOCK_PUNISH_KICK_${chatIdStr}`)
            ],
            [
                Markup.button.callback("🔇 Mute", `ANTISPAM_BLOCK_PUNISH_MUTe_${chatIdStr}`.replace("MutE".toLowerCase(), "MUTE")), // ensure MUTE
                Markup.button.callback("⛔ Ban", `ANTISPAM_BLOCK_PUNISH_BAN_${chatIdStr}`)
            ],
            [Markup.button.callback("🌟 Exceptions", `ANTISPAM_BLOCK_EXCEPTIONS_${chatIdStr}`)],
            [Markup.button.callback(`🗑 Delete Messages ${deleteMessages}`, `ANTISPAM_BLOCK_TOGGLE_DELETE_${chatIdStr}`)]
        ];

        if (["warn", "mute", "ban"].includes(penalty)) {
            const label = penalty === "warn" ? "Warn" : penalty === "mute" ? "Mute" : "Ban";
            rows.push([
                Markup.button.callback(
                    `⏲️ Set ${label} Duration (${penaltyDurationStr})`,
                    `ANTISPAM_BLOCK_SET_${label.toUpperCase()}_DURATION_${chatIdStr}`
                )
            ]);
        }

        rows.push([
            Markup.button.callback("⬅️ Back", `SET_ANTISPAM_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]);

        let text =
            `<b>🔗 Total links block</b>\n\n` +
            `With this setting, whenever any type of URL/link is detected in the group, the selected <b>Penalty</b> will be applied; if <b>Deletion</b> is ON, the message will also be deleted.\n\n` +
            `<b>Penalty:</b> ${penaltyLabel}\n` +
            `<b>Deletion:</b> ${deleteMessages === "✓" ? "On ✅" : "Off ❌"}\n`;

        if (["warn", "mute", "ban"].includes(penalty)) {
            text += `<b>Penalty duration:</b> ${penaltyDurationStr}\n\n`;
            text += `If the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.\n\n`;
        } else {
            text += `\n`;
        }

        text += `<i>👉 Use the buttons below to control this setting for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`;

        const keyboard = Markup.inlineKeyboard(rows);
        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
    }

    // Set penalty: OFF/WARN/KICK/MUTE/BAN
    bot.action(/^ANTISPAM_BLOCK_PUNISH_(OFF|WARN|KICK|MUTE|BAN)_(.+)/i, async (ctx) => {
        try {
            const action = ctx.match[1].toLowerCase();
            const chatIdStr = ctx.match[2];
            const userId = ctx.from.id;

            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            // ✅ Default duration ONLY if missing/empty (no overwrite on penalty change)
            await user_setting_module.updateOne(
                {
                    user_id: userId,
                    $or: [
                        { [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration_str`]: { $exists: false } },
                        { [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration_str`]: null },
                        { [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration_str`]: "" },
                    ],
                },
                {
                    $set: {
                        [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration_str`]: "10 minutes",
                        [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration`]: 600000,
                    },
                },
                { upsert: true }
            );

            // Always set the chosen penalty
            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.anti_spam.links_block.penalty`]: action,
                    },
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(
                `✅ Total links penalty set to ${action.charAt(0).toUpperCase() + action.slice(1)}`
            );
            await renderLinksBlockMenu(ctx, chatIdStr, userId, chat);
        } catch (err) {
            console.error("Error in ANTISPAM_BLOCK_PUNISH_* handler:", err);
        }
    });

    // Toggle delete_messages
    bot.action(/^ANTISPAM_BLOCK_TOGGLE_DELETE_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = !!doc?.settings?.[chatIdStr]?.anti_spam?.links_block?.delete_messages;
            const newVal = !current;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                { $set: { [`settings.${chatIdStr}.anti_spam.links_block.delete_messages`]: newVal } },
                { upsert: true }
            );

            await ctx.answerCbQuery(`🗑 Delete Messages ${newVal ? "enabled ✔" : "disabled ✖"}`);
            await renderLinksBlockMenu(ctx, chatIdStr, userId, chat);
        } catch (err) {
            console.error("Error in ANTISPAM_BLOCK_TOGGLE_DELETE handler:", err);
        }
    });

    // WARN duration prompt
    bot.action(/^ANTISPAM_BLOCK_SET_WARN_DURATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingLinksWarnDuration = { chatIdStr, userId, promptMessage: null };

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = doc?.settings?.[chatIdStr]?.anti_spam?.links_block || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for WARN penalty (total links)</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ANTISPAM_BLOCK_REMOVE_PUNISHMENT_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ANTISPAM_BLOCK_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery?.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            }
            if (ctx.session.awaitingLinksWarnDuration) {
                ctx.session.awaitingLinksWarnDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("ANTISPAM_BLOCK_SET_WARN_DURATION error:", err);
        }
    });

    // MUTE duration prompt
    bot.action(/^ANTISPAM_BLOCK_SET_MUTE_DURATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingLinksMuteDuration = { chatIdStr, userId, promptMessage: null };

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = doc?.settings?.[chatIdStr]?.anti_spam?.links_block || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for MUTE penalty (total links)</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ANTISPAM_BLOCK_REMOVE_PUNISHMENT_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ANTISPAM_BLOCK_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery?.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            }
            if (ctx.session.awaitingLinksMuteDuration) {
                ctx.session.awaitingLinksMuteDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("ANTISPAM_BLOCK_SET_MUTE_DURATION error:", err);
        }
    });

    // BAN duration prompt
    bot.action(/^ANTISPAM_BLOCK_SET_BAN_DURATION_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            ctx.session = ctx.session || {};
            ctx.session.awaitingLinksBanDuration = { chatIdStr, userId, promptMessage: null };

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const entry = doc?.settings?.[chatIdStr]?.anti_spam?.links_block || {};
            const current = entry?.penalty_duration_str || "None";

            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for BAN penalty (total links)</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${current}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `ANTISPAM_BLOCK_REMOVE_PUNISHMENT_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `ANTISPAM_BLOCK_CANCEL_SET_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });
            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery?.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            }
            if (ctx.session.awaitingLinksBanDuration) {
                ctx.session.awaitingLinksBanDuration.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
            }

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("ANTISPAM_BLOCK_SET_BAN_DURATION error:", err);
        }
    });

    // Remove duration (unset)
    bot.action(/^ANTISPAM_BLOCK_REMOVE_PUNISHMENT_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) return;

            await user_setting_module.findOneAndUpdate(
                { user_id: userId },
                {
                    $unset: {
                        [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration_str`]: "",
                        [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration`]: ""
                    }
                },
                { upsert: true }
            );

            if (ctx.session) {
                delete ctx.session.awaitingLinksWarnDuration;
                delete ctx.session.awaitingLinksMuteDuration;
                delete ctx.session.awaitingLinksBanDuration;
            }

            await ctx.answerCbQuery("Punishment duration removed.");
            await renderLinksBlockMenu(ctx, chatIdStr, userId, chat);
        } catch (err) {
            console.error("ANTISPAM_BLOCK_REMOVE_PUNISHMENT error:", err);
        }
    });

    // Cancel set (cleanup)
    bot.action(/^ANTISPAM_BLOCK_CANCEL_SET_(.+)/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const sW = ctx.session?.awaitingLinksWarnDuration;
            const sM = ctx.session?.awaitingLinksMuteDuration;
            const sB = ctx.session?.awaitingLinksBanDuration;
            const session = sW || sM || sB;

            if (session?.promptMessage) {
                try { await bot.telegram.deleteMessage(session.promptMessage.chatId, session.promptMessage.messageId); } catch (_) { }
            }

            if (ctx.session) {
                delete ctx.session.awaitingLinksWarnDuration;
                delete ctx.session.awaitingLinksMuteDuration;
                delete ctx.session.awaitingLinksBanDuration;
            }

            await ctx.answerCbQuery("Cancelled.");
            const userId = ctx.from.id;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (chat) await renderLinksBlockMenu(ctx, chatIdStr, userId, chat);
        } catch (err) {
            console.error("ANTISPAM_BLOCK_CANCEL_SET error:", err);
        }
    });

    // Open Total Links Exceptions menu
    bot.action(/^ANTISPAM_BLOCK_EXCEPTIONS_(-?\d+)$/, async (ctx) => {
        ctx.session = {};
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!chat) return;

        const text =
            `🌟 <b>Total Links Antispam Exceptions</b>\n\n` +
            `Manage URLs/links that should be allowed even when total links blocking is enabled.\n\n` +
            `Items added here will be allowed and not punished by the bot.`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("🔠 Show list", `ANTISPAM_BLOCK_EXCEPTIONS_SHOW_${chatIdStr}`)],
            [
                Markup.button.callback("➕ Add", `ANTISPAM_BLOCK_EXCEPTIONS_ADD_${chatIdStr}`),
                Markup.button.callback("➖ Remove", `ANTISPAM_BLOCK_EXCEPTIONS_REMOVE_${chatIdStr}`)
            ],
            [
                Markup.button.callback("⬅️ Back", `ANTISPAM_BLOCK_${chatIdStr}`),
                Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
            ]
        ]);

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
    });

    // SHOW links_block whitelist
    bot.action(/^ANTISPAM_BLOCK_EXCEPTIONS_SHOW_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userDoc = await user_setting_module.findOne({ user_id: userId });
        const whitelist = userDoc?.settings?.get(chatIdStr)?.anti_spam?.links_block?.whitelist || [];

        const escapeHTML = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const listText = whitelist.length
            ? whitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
            : "⚠️ No exceptions added yet.";

        const text = `🔠 <b>Total Links Whitelist</b>\n\n${listText}`;
        const keyboard = {
            inline_keyboard: [
                [
                    { text: "⬅️ Back", callback_data: `ANTISPAM_BLOCK_EXCEPTIONS_${chatIdStr}` },
                    { text: "🏠 Main Menu", callback_data: `GROUP_SETTINGS_${chatIdStr}` }
                ]
            ]
        };

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
    });

    // ADD prompt for links_block whitelist
    bot.action(/^ANTISPAM_BLOCK_EXCEPTIONS_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➕ <b>Add to Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, or numeric IDs (user IDs or chat IDs like <code>-100...</code>) to add them to the whitelist.\n\n" +
            "👉 Send each link/username/ID on a new line (without extra symbols), or forward a message from the users/bots/channels/groups you want to add.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram link : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n" +
            "• User/bot ID : <code>123456789</code>\n" +
            "• Group/channel ID : <code>-1001234567890</code>";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `ANTISPAM_BLOCK_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingLinksBlockAdd = { chatIdStr, userId, promptMessage: null };

        const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup }, true);

        let promptChatId = null, promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery?.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }
        if (ctx.session?.awaitingLinksBlockAdd) {
            ctx.session.awaitingLinksBlockAdd.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { }
    });

    // REMOVE prompt for links_block whitelist
    bot.action(/^ANTISPAM_BLOCK_EXCEPTIONS_REMOVE_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➖ <b>Remove from Quote Whitelist</b>\n\n" +
            "Send one or more Telegram links, <code>@usernames</code>, or numeric IDs (user IDs or chat IDs like <code>-100...</code>) to remove them from the whitelist.\n\n" +
            "👉 Send each link/username/ID on a new line (without extra symbols), or forward a message from the users/bots/channels/groups you want to remove.\n\n" +
            "<b>Example:</b>\n" +
            "• Usesrname : <code>@example</code>\n" +
            "• Telegram link : <code>https://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew</code>\n" +
            "• User/bot ID : <code>123456789</code>\n" +
            "• Group/channel ID : <code>-1001234567890</code>";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `ANTISPAM_BLOCK_EXCEPTIONS_${chatIdStr}`)]
        ]);

        ctx.session = ctx.session || {};
        ctx.session.awaitingLinksBlockRemove = { chatIdStr, userId, promptMessage: null };

        const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup }, true);

        let promptChatId = null, promptMsgId = null;
        if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
            promptMsgId = sent.message_id || sent.messageId || sent.id;
            promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
        } else if (ctx.callbackQuery?.message) {
            promptChatId = ctx.callbackQuery.message.chat.id;
            promptMsgId = ctx.callbackQuery.message.message_id;
        }
        if (ctx.session?.awaitingLinksBlockRemove) {
            ctx.session.awaitingLinksBlockRemove.promptMessage = promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null;
        }

        try { await ctx.answerCbQuery(); } catch (_) { }
    });

    //#endregion Total_links_block

    // TEXT HANDLER: many flows including unified duration saves for both tglinks and forwarding targets
    bot.on("text", async (ctx, next) => {
        ctx.session = ctx.session || {};

        // -------------------------
        // tg link / username WHITELIST ADD
        // -------------------------
        if (ctx.session.awaitingWhitelistAdd) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingWhitelistAdd;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so the user can resolve ownership/context without losing state
                return;
            }

            const inputText = (ctx.message.text || "").trim();

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

            // Simple English error if a number is sent or username core starts with a digit
            const hasNumericOrDigitStart = lines.some((raw) => {
                let s = raw.trim();
                if (!s) return false;

                // Extract core from t.me / telegram.me links
                const m = s.match(/^(?:https?:\/\/)?(?:t(?:elegram)?\.me)\/([^/?#]+)/i);
                let core = s;
                if (m) core = m[1];

                // Strip leading @
                core = core.replace(/^@/, "");

                // Ignore phone deep-links and joinchat invite codes
                if (core.startsWith("+") || /^joinchat/i.test(core)) return false;

                const isNumericOnly = /^\+?\d+$/.test(core);
                const startsWithDigit = /^\d/.test(core);
                return isNumericOnly || startsWithDigit;
            });

            if (hasNumericOrDigitStart) {
                await safeEditOrSend(
                    ctx,
                    "❌ Only usernames (e.g., <code>@example</code>) or Telegram links (<code>t.me/...</code>) are allowed. Try again",
                    { parse_mode: "HTML" }
                );
                // Do NOT delete session here; allow user to correct input and resend
                return;
            }

            const entries = [];
            const invalid = [];

            for (const line of lines) {
                const norm = validate_telegram_link_or_username(line);
                if (norm) entries.push(norm);
                else invalid.push(line);
            }

            if (!entries.length) {
                await safeEditOrSend(
                    ctx,
                    "❌ No valid usernames/links found. Please send usernames (e.g., <code>@example</code>) or <code>t.me</code> links, one per line. Try again",
                    {
                        parse_mode: "HTML"
                    }
                );
                // Keep session for correction
                return;
            }

            let saved = false;

            try {
                // Atomic: ensure doc exists & add entries
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $addToSet: {
                            [`settings.${chatIdStr}.anti_spam.telegram_links.whitelist`]: { $each: entries }
                        }
                    },
                    { upsert: true, new: true }
                );

                // fetch updated whitelist
                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.telegram_links?.whitelist || [];

                const okList = entries.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length
                    ? `\n\nInvalid lines (not added):\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}`
                    : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ Whitelist is currently empty.";

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const replyText =
                    `✅ <b>Added to whitelist</b> for <b>${safeTitle}</b>:\n\n` +
                    `${okList}${invalidList}\n\n` +
                    `📋 <b>Current whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                const keyboard = Markup.inlineKeyboard([
                    [
                        Markup.button.callback("⬅️ Back", `TGLINKS_EXCEPTIONS_${chatIdStr}`),
                        Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                    ]
                ]);

                // Clean up the prompt message if present
                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }

                await ctx.reply(replyText, { parse_mode: "HTML", ...keyboard });

                // Mark as successfully saved so we can clear the session
                saved = true;
            } catch (err) {
                console.error("Error adding to whitelist:", err);
                await ctx.reply("⚠️ Something went wrong while saving. Try again later.");
                // Keep session to allow retry
            } finally {
                if (saved) {
                    delete ctx.session.awaitingWhitelistAdd;
                }
            }

            return;
        }

        // -------------------------
        // tg link / username WHITELIST REMOVE
        // -------------------------
        if (ctx.session.awaitingWhitelistRemove) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingWhitelistRemove;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so the user can resolve ownership/context without losing state
                return;
            }

            const inputText = (ctx.message.text || "").trim();

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const toRemove = [];
            const invalid = [];

            // Helper: numeric-only or username core starts with a digit
            const isNumericOrDigitStart = (raw) => {
                let s = String(raw || "").trim();
                if (!s) return false;

                // Extract core from t.me / telegram.me links
                const m = s.match(/^(?:https?:\/\/)?(?:t(?:elegram)?\.me)\/([^/?#]+)/i);
                let core = s;
                if (m) core = m[1];

                // Strip leading @
                core = core.replace(/^@/, "");

                // Ignore phone deep-links (+...) and joinchat invite codes
                if (core.startsWith("+") || /^joinchat/i.test(core)) return false;

                const isNumericOnly = /^\+?\d+$/.test(core);
                const startsWithDigit = /^\d/.test(core);
                return isNumericOnly || startsWithDigit;
            };

            // Only typed usernames/links are allowed (forwarded inputs removed)
            const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

            // Simple English error if any typed line is numeric-only or starts with a digit
            const hasNumericOrDigitStart = lines.some(isNumericOrDigitStart);
            if (hasNumericOrDigitStart) {
                await safeEditOrSend(
                    ctx,
                    "❌ Only usernames (e.g., <code>@example</code>) or Telegram links (<code>t.me/...</code>) are allowed. Try again",
                    { parse_mode: "HTML" }
                );
                // Keep session for correction
                return;
            }

            for (const line of lines) {
                const norm = validate_telegram_link_or_username(line);
                if (norm) toRemove.push(norm);
                else invalid.push(line);
            }

            if (!toRemove.length) {
                await safeEditOrSend(
                    ctx,
                    "❌ No valid usernames/links found to remove. Please send usernames (e.g., <code>@example</code>) or <code>t.me</code> links, one per line. Try again",
                    { parse_mode: "HTML" }
                );
                // Keep session for correction
                return;
            }

            let saved = false;

            try {
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $pull: {
                            [`settings.${chatIdStr}.anti_spam.telegram_links.whitelist`]: { $in: toRemove }
                        }
                    },
                    { upsert: true, new: true }
                );

                // fetch updated whitelist
                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.telegram_links?.whitelist || [];

                const removedList = toRemove.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length
                    ? `\n\nInvalid lines (not removed):\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}`
                    : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ Whitelist is currently empty.";

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const replyText =
                    `✅ <b>Removed from whitelist</b> for <b>${safeTitle}</b>:\n\n` +
                    `${removedList}${invalidList}\n\n` +
                    `📋 <b>Current whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                const keyboard = Markup.inlineKeyboard([
                    [
                        Markup.button.callback("⬅️ Back", `TGLINKS_EXCEPTIONS_${chatIdStr}`),
                        Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
                    ]
                ]);

                // delete prompt/cancel message if exists
                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { /* ignore */ }
                }

                await ctx.reply(replyText, { parse_mode: "HTML", ...keyboard });

                saved = true;
            } catch (err) {
                console.error("Error removing from whitelist:", err);
                await ctx.reply("⚠️ Something went wrong while removing. Try again later.");
                // Keep session to allow retry
            } finally {
                if (saved) {
                    delete ctx.session.awaitingWhitelistRemove;
                }
            }
            return;
        }

        // -------------------------
        // FORWARDING EXCEPTIONS ADD (text handler)
        // -------------------------
        if (ctx.session.awaitingForwardAdd) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingForwardAdd;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so state isn’t lost
                return;
            }

            const inputText = (ctx.message.text || "").trim();

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const entries = [];
            const invalid = [];

            // Regexes for accepted ID/link formats
            const reUserIdBare = /^\d{5,20}$/;                    // bare user id (digits only)
            const reTgUserId = /^tg:\/\/user\?id=(\d{5,20})$/i; // input accepted but normalized to bare id
            const reChatId = /^-100\d{5,20}$/;                // supergroup/channel chat id
            const reTmeC = /^(?:https?:\/\/)?t(?:elegram)?\.me\/c\/(\d{5,20})(?:\/\d+)?$/i; // t.me/c/<id>(/post)

            // Username must not start with a digit
            const startsWithDigitUsername = (raw) => {
                let s = String(raw || "").trim();
                // Extract username core from t.me/username if present
                const mUser = s.match(/^(?:https?:\/\/)?t(?:elegram)?\.me\/([^\/?#]+)/i);
                let core = mUser ? mUser[1] : s;
                core = core.replace(/^@/, "");
                if (!core) return false;
                // Skip phone deep-links and invite joins
                if (core.startsWith("+") || /^joinchat/i.test(core)) return false;
                return /^[0-9]/.test(core);
            };

            // Collect inputs from forward metadata or typed text
            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) entries.push(`@${fc.username}`);
                else entries.push(String(fc.id)); // store direct -100... chat id
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) entries.push(`@${fu.username}`);
                else entries.push(String(fu.id)); // store direct user id
            } else {
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

                // Early validation: reject digit-leading usernames, but allow numeric IDs if valid
                const hasBadUsernames = lines.some((s) => {
                    if (reUserIdBare.test(s)) return false;
                    if (reTgUserId.test(s)) return false;
                    if (reChatId.test(s)) return false;
                    if (reTmeC.test(s)) return false;
                    return startsWithDigitUsername(s);
                });

                // Detect malformed numeric-like inputs
                const hasMalformedNumeric = lines.some((s) => {
                    if (reUserIdBare.test(s)) return false;
                    if (reTgUserId.test(s)) return false;
                    if (reChatId.test(s)) return false;
                    if (reTmeC.test(s)) return false;
                    // If it looks numeric-ish but not one of the accepted patterns, mark malformed
                    const numericish = /^[+\-]?\d+$/.test(s) || /id=\d+/.test(s) || /\/c\/\d+/.test(s);
                    return numericish;
                });

                if (hasBadUsernames || hasMalformedNumeric) {
                    await ctx.reply(
                        "❌ Only <code>@username</code>, <code>t.me</code> links, user IDs, or -100 chat IDs are allowed. Try again",
                    );
                    // Keep session for correction
                    return;
                }

                // Normalize and collect
                for (const s of lines) {
                    // Bare user id -> store as direct digits
                    if (reUserIdBare.test(s)) {
                        entries.push(s);
                        continue;
                    }
                    // tg://user?id=<id> -> normalize to bare id (no tg:// stored or shown)
                    const mTg = s.match(reTgUserId);
                    if (mTg) {
                        entries.push(mTg[1]);
                        continue;
                    }
                    // -100... chat id -> keep as-is (bare -100 id)
                    if (reChatId.test(s)) {
                        entries.push(s);
                        continue;
                    }
                    // t.me/c/<id>(/post) -> normalize to bare -100<id>
                    const mC = s.match(reTmeC);
                    if (mC) {
                        entries.push(`-100${mC[1]}`);
                        continue;
                    }

                    // Fallback to existing validator for @username or t.me/username
                    const norm = await Promise.resolve(validate_telegram_link_or_username(s));
                    if (norm) entries.push(norm);
                    else invalid.push(s);
                }
            }

            if (!entries.length) {
                await ctx.reply(
                    "❌ No valid usernames/IDs/links found. Please send <code>@username</code>, <code>t.me</code> links, user IDs or -100 chat IDs. Try again",
                );
                // Keep session for correction
                return;
            }

            let saved = false;

            try {
                // Upsert + addToSet
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $addToSet: {
                            [`settings.${chatIdStr}.anti_spam.forwarding.whitelist`]: { $each: entries }
                        }
                    },
                    { upsert: true, new: true }
                );

                // Fetch updated forward whitelist
                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.whitelist || [];

                const okList = entries.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length ? `\n\nInvalid:\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}` : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ No exceptions added yet.";

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}`),
                    Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ]);

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const replyText =
                    `✅ <b>Added to whitelist</b> for <b>${safeTitle}</b>:\n\n${okList}${invalidList}\n\n📋 <b>Current forward whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }

                await ctx.reply(replyText, { parse_mode: "HTML", ...keyboard });

                saved = true;
            } catch (err) {
                console.error("Error adding to forward exceptions:", err);
                await ctx.reply("⚠️ Something went wrong while saving. Try again later.");
                // Keep session for retry
            } finally {
                if (saved) {
                    delete ctx.session.awaitingForwardAdd;
                }
            }
            return;
        }

        // -------------------------
        // FORWARDING EXCEPTIONS REMOVE (text handler)
        // -------------------------
        if (ctx.session.awaitingForwardRemove) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingForwardRemove;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) { delete ctx.session.awaitingForwardRemove; return; }

            const inputText = (ctx.message.text || "").trim();
            const toRemove = [];
            const invalid = [];

            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) toRemove.push(`@${fc.username}`);
                else toRemove.push(`https://t.me/c/${Math.abs(fc.id)}`);
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) toRemove.push(`@${fu.username}`);
                else toRemove.push(`tg://user?id=${fu.id}`);
            } else {
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                    const norm = await Promise.resolve(validate_telegram_link_or_username(line));
                    if (norm) toRemove.push(norm);
                    else invalid.push(line);
                }
            }

            if (!toRemove.length) {
                await ctx.reply("❌ Only <code>@username</code>, <code>t.me</code> links, user IDs, or -100 chat IDs are allowed. Try again");
                return;
            }

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            try {
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId, [`settings.${chatIdStr}.anti_spam.forwarding.delete_messages`]: false },
                        $pull: { [`settings.${chatIdStr}.anti_spam.forwarding.whitelist`]: { $in: toRemove } }
                    },
                    { upsert: true, new: true }
                );

                // fetch updated forwarding whitelist
                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.forwarding?.whitelist || [];

                const removedList = toRemove.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length ? `\n\nInvalid:\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}` : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ No exceptions added yet.";

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const text = `✅ <b>Removed from exceptions</b> for <b>${safeTitle}</b>:\n\n${removedList}${invalidList}\n\n📋 <b>Current forward whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ]);

                // delete prompt/cancel message if exists
                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { /* ignore */ }
                }

                await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });
            } catch (err) {
                console.error("Error removing from forward exceptions:", err);
                await ctx.reply("⚠️ Something went wrong while removing. Try again later.");
            } finally {
                delete ctx.session.awaitingForwardRemove;
            }
            return;
        }

        // -------------------------
        // UNIFIED PUNISHMENT DURATION FLOWS (TGLINKS warn/mute/ban)
        // -------------------------
        const handleSavePenaltyDuration = async (sessionKey, penaltyValue, successMessage) => {
            const session = ctx.session[sessionKey];
            if (!session) return false;

            const { chatIdStr, userId, promptMessage } = session;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) { delete ctx.session[sessionKey]; return true; }

            const rawInput = (ctx.message.text || "").trim();
            if (!rawInput) {
                await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return true;
            }

            const totalSeconds = parseDurationToSeconds(rawInput);
            if (totalSeconds === null) {
                await ctx.reply("❌ Couldn't parse duration. Use format like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return true;
            }

            const MIN_SECONDS = 30;
            const MAX_SECONDS = 365 * 24 * 3600;
            if (totalSeconds < MIN_SECONDS) {
                await ctx.reply("❌ Duration is too short. Minimum is 30 seconds.");
                return true;
            }
            if (totalSeconds > MAX_SECONDS) {
                await ctx.reply("❌ Duration is too long. Maximum is 365 days.");
                return true;
            }

            const msValue = totalSeconds * 1000;
            try {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration_str`]: rawInput,
                            [`settings.${chatIdStr}.anti_spam.telegram_links.penalty_duration`]: msValue,
                            [`settings.${chatIdStr}.anti_spam.telegram_links.penalty`]: penaltyValue
                        }
                    },
                    { upsert: true }
                );
            } catch (dbErr) {
                console.error("DB error saving punishment duration:", dbErr);
                await ctx.reply("❌ Failed to save duration due to a server error.");
                delete ctx.session[sessionKey];
                return true;
            }

            // delete prompt message shown to the user (if available)
            try {
                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { /* ignore */ }
                }
            } catch (_) { /* ignore */ }

            delete ctx.session[sessionKey];
            await ctx.reply(successMessage.replace("{DURATION}", rawInput));
            await renderTgLinksMenu(ctx, chatIdStr, userId, await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId));
            return true;
        };

        // -------------------------
        // QUOTE EXCEPTIONS ADD (text handler)
        // -------------------------
        if (ctx.session?.awaitingQuoteAdd) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingQuoteAdd;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so state isn’t lost
                return;
            }

            const inputText = (ctx.message.text || "").trim();

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const entries = [];
            const invalid = [];

            // Regexes for accepted ID/link formats (no external URLs stored)
            const reUserIdBare = /^\d{5,20}$/;                    // bare user id (digits only) [accept/store bare]
            const reTgUserId = /^tg:\/\/user\?id=(\d{5,20})$/i; // accepted input; normalized to bare id
            const reChatId = /^-100\d{5,20}$/;                // supergroup/channel chat id (store bare -100...)
            const reTmeC = /^(?:https?:\/\/)?t(?:elegram)?\.me\/c\/(\d{5,20})(?:\/\d+)?$/i; // t.me/c/<id>(/post) -> -100<id>

            // Username must not start with a digit
            const startsWithDigitUsername = (raw) => {
                let s = String(raw || "").trim();
                // Extract username core from t.me/username if present
                const mUser = s.match(/^(?:https?:\/\/)?t(?:elegram)?\.me\/([^\/?#]+)/i);
                let core = mUser ? mUser[1] : s;
                core = core.replace(/^@/, "");
                if (!core) return false;
                // Skip phone deep-links and invite joins
                if (core.startsWith("+") || /^joinchat/i.test(core)) return false;
                return /^[0-9]/.test(core);
            };

            // Collect inputs from forward metadata or typed text
            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) entries.push(`@${fc.username}`);
                else entries.push(String(fc.id)); // store direct -100... chat id
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) entries.push(`@${fu.username}`);
                else entries.push(String(fu.id)); // store direct user id
            } else {
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

                // Early validation: reject digit-leading usernames; allow valid numeric ID shapes
                const hasBadUsernames = lines.some((s) => {
                    if (reUserIdBare.test(s)) return false;
                    if (reTgUserId.test(s)) return false;
                    if (reChatId.test(s)) return false;
                    if (reTmeC.test(s)) return false;
                    return startsWithDigitUsername(s);
                });

                // Detect malformed numeric-like inputs
                const hasMalformedNumeric = lines.some((s) => {
                    if (reUserIdBare.test(s)) return false;
                    if (reTgUserId.test(s)) return false;
                    if (reChatId.test(s)) return false;
                    if (reTmeC.test(s)) return false;
                    // If it looks numeric-ish but not one of the accepted patterns, mark malformed
                    const numericish = /^[+\-]?\d+$/.test(s) || /id=\d+/.test(s) || /\/c\/\d+/.test(s);
                    return numericish;
                });

                if (hasBadUsernames || hasMalformedNumeric) {
                    await ctx.reply(
                        "❌ Only <code>@username</code>, <code>t.me/username</code>, user IDs (digits only), or -100 chat IDs are allowed. Try again.",
                    );
                    // Keep session for correction
                    return;
                }

                // Normalize and collect
                for (const s of lines) {
                    // Bare user id -> store as direct digits
                    if (reUserIdBare.test(s)) {
                        entries.push(s);
                        continue;
                    }
                    // tg://user?id=<id> -> normalize to bare id (no tg:// stored)
                    const mTg = s.match(reTgUserId);
                    if (mTg) {
                        entries.push(mTg[1]);
                        continue;
                    }
                    // -100... chat id -> keep as-is (bare -100 id)
                    if (reChatId.test(s)) {
                        entries.push(s);
                        continue;
                    }
                    // t.me/c/<id>(/post) -> normalize to bare -100<id>
                    const mC = s.match(reTmeC);
                    if (mC) {
                        entries.push(`-100${mC[1]}`);
                        continue;
                    }

                    // Fallback to existing validator for @username or t.me/username
                    const norm = await Promise.resolve(validate_telegram_link_or_username(s));
                    if (norm) entries.push(norm);
                    else invalid.push(s);
                }
            }

            if (!entries.length) {
                await ctx.reply(
                    "❌ No valid usernames/IDs/links found. Please send <code>@username</code>, <code>t.me/username</code>, user IDs (digits only), or -100 chat IDs.",
                );
                // Keep session for correction
                return;
            }

            let saved = false;

            try {
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $addToSet: { [`settings.${chatIdStr}.anti_spam.quote.whitelist`]: { $each: entries } }
                    },
                    { upsert: true, new: true }
                );

                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.whitelist || [];

                const okList = entries.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length ? `\n\nInvalid:\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}` : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ No exceptions added yet.";

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `ANTISPAM_QUOTE_EXCEPTIONS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ]);

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const replyText =
                    `✅ <b>Added to quote whitelist</b> for <b>${safeTitle}</b>:\n\n${okList}${invalidList}\n\n📋 <b>Current quote whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                if (promptMessage?.chatId && promptMessage?.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }

                await ctx.reply(replyText, { parse_mode: "HTML", ...keyboard });

                saved = true;
            } catch (err) {
                console.error("Error adding to quote exceptions:", err);
                await ctx.reply("⚠️ Something went wrong while saving. Try again later.");
            } finally {
                if (saved) {
                    delete ctx.session.awaitingQuoteAdd;
                }
            }
            return;
        }

        // -------------------------
        // QUOTE EXCEPTIONS REMOVE (text handler)
        // -------------------------
        if (ctx.session?.awaitingQuoteRemove) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingQuoteRemove;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so state isn’t lost
                return;
            }

            const inputText = (ctx.message.text || "").trim();

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const toRemove = [];
            const invalid = [];

            // Accept only typed or forwarded; normalize to raw IDs/usernames
            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) toRemove.push(`@${fc.username}`);
                else toRemove.push(String(fc.id)); // store direct -100... chat id
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) toRemove.push(`@${fu.username}`);
                else toRemove.push(String(fu.id)); // store direct user id
            } else {
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

                // Same validators as ADD
                const reUserIdBare = /^\d{5,20}$/;
                const reTgUserId = /^tg:\/\/user\?id=(\d{5,20})$/i;
                const reChatId = /^-100\d{5,20}$/;
                const reTmeC = /^(?:https?:\/\/)?t(?:elegram)?\.me\/c\/(\d{5,20})(?:\/\d+)?$/i;

                const startsWithDigitUsername = (raw) => {
                    let s = String(raw || "").trim();
                    const mUser = s.match(/^(?:https?:\/\/)?t(?:elegram)?\.me\/([^\/?#]+)/i);
                    let core = mUser ? mUser[1] : s;
                    core = core.replace(/^@/, "");
                    if (!core) return false;
                    if (core.startsWith("+") || /^joinchat/i.test(core)) return false;
                    return /^[0-9]/.test(core);
                };

                const hasBadUsernames = lines.some((s) => {
                    if (reUserIdBare.test(s)) return false;
                    if (reTgUserId.test(s)) return false;
                    if (reChatId.test(s)) return false;
                    if (reTmeC.test(s)) return false;
                    return startsWithDigitUsername(s);
                });

                const hasMalformedNumeric = lines.some((s) => {
                    if (reUserIdBare.test(s)) return false;
                    if (reTgUserId.test(s)) return false;
                    if (reChatId.test(s)) return false;
                    if (reTmeC.test(s)) return false;
                    const numericish = /^[+\-]?\d+$/.test(s) || /id=\d+/.test(s) || /\/c\/\d+/.test(s);
                    return numericish;
                });

                if (hasBadUsernames || hasMalformedNumeric) {
                    await ctx.reply("❌ Only <code>@username</code>, <code>t.me/username</code>, user IDs (digits only), or -100 chat IDs are allowed. Try again.");
                    return;
                }

                for (const line of lines) {
                    const s = line;

                    if (reUserIdBare.test(s)) { toRemove.push(s); continue; }

                    const mTg = s.match(reTgUserId);
                    if (mTg) { toRemove.push(mTg[1]); continue; }

                    if (reChatId.test(s)) { toRemove.push(s); continue; }

                    const mC = s.match(reTmeC);
                    if (mC) { toRemove.push(`-100${mC[1]}`); continue; }

                    const norm = await Promise.resolve(validate_telegram_link_or_username(s));
                    if (norm) toRemove.push(norm);
                    else invalid.push(s);
                }
            }

            if (!toRemove.length) {
                await ctx.reply("❌ No valid usernames/IDs/links found to remove. Please send <code>@username</code>, <code>t.me/username</code>, user IDs (digits only), or -100 chat IDs.");
                return;
            }

            let saved = false;

            try {
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $pull: { [`settings.${chatIdStr}.anti_spam.quote.whitelist`]: { $in: toRemove } }
                    },
                    { upsert: true, new: true }
                );

                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.quote?.whitelist || [];

                const removedList = toRemove.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length ? `\n\nInvalid:\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}` : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ No exceptions added yet.";

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const text =
                    `✅ <b>Removed from quote exceptions</b> for <b>${safeTitle}</b>:\n\n${removedList}${invalidList}\n\n📋 <b>Current quote whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `ANTISPAM_QUOTE_EXCEPTIONS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ]);

                if (promptMessage?.chatId && promptMessage?.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }

                await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });

                saved = true;
            } catch (err) {
                console.error("Error removing from quote exceptions:", err);
                await ctx.reply("⚠️ Something went wrong while removing. Try again later.");
            } finally {
                if (saved) {
                    delete ctx.session.awaitingQuoteRemove;
                }
            }
            return;
        }

        // Utility: simple URL/domain detector
        const isLikelyUrlOrDomain = (s) => {
            const str = String(s).trim();
            if (!str) return false;
            const urlLike = /^(https?:\/\/|ftp:\/\/|tg:\/\/|www\.)/i.test(str);
            const domainLike = /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(str);
            return urlLike || domainLike;
        };

        // -------------------------
        // LINKS BLOCK EXCEPTIONS ADD
        // -------------------------
        if (ctx.session?.awaitingLinksBlockAdd) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingLinksBlockAdd;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so state isn’t lost
                return;
            }

            const inputText = (ctx.message.text || "").trim();
            const entries = [];
            const invalid = [];

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            // Telegram entity validators (store raw IDs / usernames)
            const reUserIdBare = /^\d{5,20}$/;                    // bare user id (digits only) [store bare] [accept]
            const reTgUserId = /^tg:\/\/user\?id=(\d{5,20})$/i; // accepted input; normalized to bare id [accept]
            const reChatId = /^-100\d{5,20}$/;                // supergroup/channel chat id (store bare -100...) [accept]
            const reTmeC = /^(?:https?:\/\/)?t(?:elegram)?\.me\/c\/(\d{5,20})(?:\/\d+)?$/i; // t.me/c/<id>(/post) -> -100<id> [accept]

            // Username must not start with a digit
            const startsWithDigitUsername = (raw) => {
                let s = String(raw || "").trim();
                // Extract username core from t.me/username if present
                const mUser = s.match(/^(?:https?:\/\/)?t(?:elegram)?\.me\/([^\/?#]+)/i);
                let core = mUser ? mUser[1] : s;
                core = core.replace(/^@/, "");
                if (!core) return false;
                // Skip phone deep-links and invite joins
                if (core.startsWith("+") || /^joinchat/i.test(core)) return false;
                return /^[0-9]/.test(core);
            };

            // Handle forwards: store raw IDs or @username for Telegram entities; for generic links, user must type them
            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) entries.push(`@${fc.username}`);
                else entries.push(String(fc.id)); // store direct -100... chat id
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) entries.push(`@${fu.username}`);
                else entries.push(String(fu.id)); // store direct user id
            } else {
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

                // Early validation for Telegram usernames/IDs:
                // - Reject digit-leading usernames
                // - Allow valid numeric ID shapes
                // - Allow generic non-Telegram links/domains via isLikelyUrlOrDomain
                let hasBadUsernames = false;
                let hasMalformedNumeric = false;

                for (const s of lines) {
                    // If it’s a generic URL/domain, allow; skip Telegram-specific checks for it
                    if (isLikelyUrlOrDomain(s)) continue;

                    // Telegram-specific acceptance
                    if (reUserIdBare.test(s)) continue;
                    if (reTgUserId.test(s)) continue;
                    if (reChatId.test(s)) continue;
                    if (reTmeC.test(s)) continue;

                    // Digit-leading username?
                    if (startsWithDigitUsername(s)) { hasBadUsernames = true; break; }

                    // Numeric-ish but not acceptable Telegram ID shape?
                    const numericish = /^[+\-]?\d+$/.test(s) || /id=\d+/.test(s) || /\/c\/\d+/.test(s);
                    if (numericish) { hasMalformedNumeric = true; break; }
                }

                if (hasBadUsernames || hasMalformedNumeric) {
                    await ctx.reply(
                        "❌ Only <code>@username</code>, <code>t.me/username</code>, digits-only user IDs, -100 chat IDs, or valid links/domains are allowed. Try again.",
                    );
                    // Keep session for correction
                    return;
                }

                // Normalize and collect
                for (const s of lines) {
                    // Non-Telegram: allow domains/URLs as-is
                    if (isLikelyUrlOrDomain(s)) {
                        entries.push(s.trim());
                        continue;
                    }

                    // Telegram numeric/usernames normalization
                    if (reUserIdBare.test(s)) { entries.push(s); continue; }

                    const mTg = s.match(reTgUserId);
                    if (mTg) { entries.push(mTg[1]); continue; }

                    if (reChatId.test(s)) { entries.push(s); continue; }

                    const mC = s.match(reTmeC);
                    if (mC) { entries.push(`-100${mC[1]}`); continue; }

                    // Fallback: @username or t.me/username
                    const normTg = await Promise.resolve(validate_telegram_link_or_username(s));
                    if (normTg) { entries.push(normTg); continue; }

                    invalid.push(s);
                }
            }

            if (!entries.length) {
                await ctx.reply("❌ No valid usernames/IDs/links/domains found. Try again.");
                return;
            }

            let saved = false;

            try {
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $addToSet: { [`settings.${chatIdStr}.anti_spam.links_block.whitelist`]: { $each: entries } }
                    },
                    { upsert: true, new: true }
                );

                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.links_block?.whitelist || [];

                const okList = entries.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length ? `\n\nInvalid:\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}` : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ No exceptions added yet.";

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `ANTISPAM_BLOCK_EXCEPTIONS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ]);

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const replyText =
                    `✅ <b>Added to total links whitelist</b> for <b>${safeTitle}</b>:\n\n${okList}${invalidList}\n\n📋 <b>Current whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                if (promptMessage?.chatId && promptMessage?.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }

                await ctx.reply(replyText, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });

                saved = true;
            } catch (err) {
                console.error("Error adding to links_block exceptions:", err);
                await ctx.reply("⚠️ Something went wrong while saving. Try again later.");
            } finally {
                if (saved) {
                    delete ctx.session.awaitingLinksBlockAdd;
                }
            }
            return;
        }

        // -------------------------
        // LINKS BLOCK EXCEPTIONS REMOVE
        // -------------------------
        if (ctx.session?.awaitingLinksBlockRemove) {
            const { chatIdStr, userId, promptMessage } = ctx.session.awaitingLinksBlockRemove;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                // Keep session so state isn’t lost
                return;
            }

            const inputText = (ctx.message.text || "").trim();
            const toRemove = [];
            const invalid = [];

            const escapeHTML = (s = "") => String(s)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            // Same validators as ADD
            const reUserIdBare = /^\d{5,20}$/;
            const reTgUserId = /^tg:\/\/user\?id=(\d{5,20})$/i;
            const reChatId = /^-100\d{5,20}$/;
            const reTmeC = /^(?:https?:\/\/)?t(?:elegram)?\.me\/c\/(\d{5,20})(?:\/\d+)?$/i;

            const startsWithDigitUsername = (raw) => {
                let s = String(raw || "").trim();
                const mUser = s.match(/^(?:https?:\/\/)?t(?:elegram)?\.me\/([^\/?#]+)/i);
                let core = mUser ? mUser[1] : s;
                core = core.replace(/^@/, "");
                if (!core) return false;
                if (core.startsWith("+") || /^joinchat/i.test(core)) return false;
                return /^[0-9]/.test(core);
            };

            // Handle forwards similar to ADD: raw IDs or @username for Telegram; typed lines support Telegram + generic URLs/domains
            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) toRemove.push(`@${fc.username}`);
                else toRemove.push(String(fc.id)); // direct -100...
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) toRemove.push(`@${fu.username}`);
                else toRemove.push(String(fu.id)); // direct user id
            } else {
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);

                let hasBadUsernames = false;
                let hasMalformedNumeric = false;

                for (const s of lines) {
                    if (isLikelyUrlOrDomain(s)) continue;

                    if (reUserIdBare.test(s)) continue;
                    if (reTgUserId.test(s)) continue;
                    if (reChatId.test(s)) continue;
                    if (reTmeC.test(s)) continue;

                    if (startsWithDigitUsername(s)) { hasBadUsernames = true; break; }

                    const numericish = /^[+\-]?\d+$/.test(s) || /id=\d+/.test(s) || /\/c\/\d+/.test(s);
                    if (numericish) { hasMalformedNumeric = true; break; }
                }

                if (hasBadUsernames || hasMalformedNumeric) {
                    await ctx.reply("❌ Only <code>@username</code>, <code>t.me/username</code>, digits-only user IDs, -100 chat IDs, or valid links/domains are allowed. Try again.");
                    return;
                }

                for (const s of lines) {
                    if (isLikelyUrlOrDomain(s)) { toRemove.push(s.trim()); continue; }

                    if (reUserIdBare.test(s)) { toRemove.push(s); continue; }

                    const mTg = s.match(reTgUserId);
                    if (mTg) { toRemove.push(mTg[1]); continue; }

                    if (reChatId.test(s)) { toRemove.push(s); continue; }

                    const mC = s.match(reTmeC);
                    if (mC) { toRemove.push(`-100${mC[1]}`); continue; }

                    const normTg = await Promise.resolve(validate_telegram_link_or_username(s));
                    if (normTg) { toRemove.push(normTg); continue; }

                    invalid.push(s);
                }
            }

            if (!toRemove.length) {
                await ctx.reply("❌ No valid usernames/IDs/links/domains found to remove. Try again.");
                return;
            }

            let saved = false;

            try {
                await user_setting_module.findOneAndUpdate(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $pull: { [`settings.${chatIdStr}.anti_spam.links_block.whitelist`]: { $in: toRemove } }
                    },
                    { upsert: true, new: true }
                );

                const updatedDoc = await user_setting_module.findOne({ user_id: userId }).lean();
                const updatedWhitelist = updatedDoc?.settings?.[chatIdStr]?.anti_spam?.links_block?.whitelist || [];

                const removedList = toRemove.map(e => `• <code>${escapeHTML(e)}</code>`).join("\n");
                const invalidList = invalid.length ? `\n\nInvalid:\n${invalid.map(i => `• <code>${escapeHTML(i)}</code>`).join("\n")}` : "";
                const fullListText = updatedWhitelist.length
                    ? updatedWhitelist.map((item, i) => `${i + 1}. <code>${escapeHTML(item)}</code>`).join("\n")
                    : "⚠️ No exceptions added yet.";

                const safeTitle = escapeHTML(chat.title || chatIdStr);
                const text =
                    `✅ <b>Removed from total links exceptions</b> for <b>${safeTitle}</b>:\n\n${removedList}${invalidList}\n\n📋 <b>Current whitelist (${updatedWhitelist.length})</b>:\n${fullListText}`;

                const keyboard = Markup.inlineKeyboard([
                    [Markup.button.callback("⬅️ Back", `ANTISPAM_BLOCK_EXCEPTIONS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
                ]);

                if (promptMessage?.chatId && promptMessage?.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }

                await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard.reply_markup });

                saved = true;
            } catch (err) {
                console.error("Error removing from links_block exceptions:", err);
                await ctx.reply("⚠️ Something went wrong while removing. Try again later.");
            } finally {
                if (saved) {
                    delete ctx.session.awaitingLinksBlockRemove;
                }
            }
            return;
        }

        // TGLINKS WARN
        if (ctx.session.awaitingTgLinksWarnDuration) {
            const done = await handleSavePenaltyDuration("awaitingTgLinksWarnDuration", "warn", "✅ Warn duration saved: {DURATION}");
            if (done) return;
        }
        // TGLINKS MUTE
        if (ctx.session.awaitingTgLinksMuteDuration) {
            const done = await handleSavePenaltyDuration("awaitingTgLinksMuteDuration", "mute", "✅ Mute duration saved: {DURATION}");
            if (done) return;
        }
        // TGLINKS BAN
        if (ctx.session.awaitingTgLinksBanDuration) {
            const done = await handleSavePenaltyDuration("awaitingTgLinksBanDuration", "ban", "✅ Ban duration saved: {DURATION}");
            if (done) return;
        }

        // -------------------------
        // FORWARDING target duration flows (warn/mute/ban) - helper
        // -------------------------
        const handleSaveForwardDuration = async (sessionKey, penaltyValue, successLabel) => {
            const session = ctx.session[sessionKey];
            if (!session) return false;

            const { chatIdStr, target, userId, promptMessage } = session;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) { delete ctx.session[sessionKey]; return true; }

            const rawInput = (ctx.message.text || "").trim();
            if (!rawInput) {
                await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return true;
            }

            const totalSeconds = parseDurationToSeconds(rawInput);
            if (totalSeconds === null) {
                await ctx.reply("❌ Couldn't parse duration. Use format like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return true;
            }

            const MIN_SECONDS = 30;
            const MAX_SECONDS = 365 * 24 * 3600;
            if (totalSeconds < MIN_SECONDS) { await ctx.reply("❌ Duration is too short. Minimum is 30 seconds."); return true; }
            if (totalSeconds > MAX_SECONDS) { await ctx.reply("❌ Duration is too long. Maximum is 365 days."); return true; }

            const msValue = totalSeconds * 1000;
            try {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration_str`]: rawInput,
                            [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty_duration`]: msValue,
                            [`settings.${chatIdStr}.anti_spam.forwarding.${target}.penalty`]: penaltyValue
                        }
                    },
                    { upsert: true }
                );
            } catch (dbErr) {
                console.error("DB error saving forward duration:", dbErr);
                await ctx.reply("❌ Failed to save duration due to a server error.");
                delete ctx.session[sessionKey];
                return true;
            }

            // delete prompt message shown to the user (if available)
            try {
                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { /* ignore */ }
                }
            } catch (_) { /* ignore */ }

            delete ctx.session[sessionKey];
            await ctx.reply(`✅ Forward ${successLabel} duration saved for ${capitalize(target)}: ${rawInput}`);
            await renderForwardTargetMenu(ctx, chatIdStr, target);
            return true;
        };

        // Forward warn/mute/ban
        if (ctx.session.awaitingForwardWarnDuration) {
            const done = await handleSaveForwardDuration("awaitingForwardWarnDuration", "warn", "warn");
            if (done) return;
        }
        if (ctx.session.awaitingForwardMuteDuration) {
            const done = await handleSaveForwardDuration("awaitingForwardMuteDuration", "mute", "mute");
            if (done) return;
        }
        if (ctx.session.awaitingForwardBanDuration) {
            const done = await handleSaveForwardDuration("awaitingForwardBanDuration", "ban", "ban");
            if (done) return;
        }



        // -------------------------
        // QUOTE target duration flows (warn/mute/ban) - helper
        // -------------------------
        const handleSaveQuoteDuration = async (sessionKey, penaltyValue, successLabel) => {
            const session = ctx.session[sessionKey];
            if (!session) return false;

            const { chatIdStr, target, userId, promptMessage } = session;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) { delete ctx.session[sessionKey]; return true; }

            const rawInput = (ctx.message.text || "").trim();
            if (!rawInput) {
                await ctx.reply("❌ Invalid input. Send duration like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return true;
            }

            const totalSeconds = parseDurationToSeconds(rawInput);
            if (totalSeconds === null) {
                await ctx.reply("❌ Couldn't parse duration. Use format like `3 month 2 days 12 hours 4 minutes 34 seconds` or a single number (minutes).");
                return true;
            }

            const MIN_SECONDS = 30;
            const MAX_SECONDS = 365 * 24 * 3600;
            if (totalSeconds < MIN_SECONDS) { await ctx.reply("❌ Duration is too short. Minimum is 30 seconds."); return true; }
            if (totalSeconds > MAX_SECONDS) { await ctx.reply("❌ Duration is too long. Maximum is 365 days."); return true; }

            const msValue = totalSeconds * 1000;
            try {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration_str`]: rawInput,
                            [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty_duration`]: msValue,
                            [`settings.${chatIdStr}.anti_spam.quote.${target}.penalty`]: penaltyValue
                        }
                    },
                    { upsert: true }
                );
            } catch (dbErr) {
                console.error("DB error saving quote duration:", dbErr);
                await ctx.reply("❌ Failed to save duration due to a server error.");
                delete ctx.session[sessionKey];
                return true;
            }

            try {
                if (promptMessage && promptMessage.chatId && promptMessage.messageId) {
                    try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
                }
            } catch (_) { }

            delete ctx.session[sessionKey];
            await ctx.reply(`✅ Quote ${successLabel} duration saved for ${target.charAt(0).toUpperCase() + target.slice(1)}: ${rawInput}`);
            await renderQuoteTargetMenu(ctx, chatIdStr, target);
            return true;
        };

        // Quote warn/mute/ban saves
        if (ctx.session.awaitingQuoteWarnDuration) {
            const done = await handleSaveQuoteDuration("awaitingQuoteWarnDuration", "warn", "warn");
            if (done) return;
        }
        if (ctx.session.awaitingQuoteMuteDuration) {
            const done = await handleSaveQuoteDuration("awaitingQuoteMuteDuration", "mute", "mute");
            if (done) return;
        }
        if (ctx.session.awaitingQuoteBanDuration) {
            const done = await handleSaveQuoteDuration("awaitingQuoteBanDuration", "ban", "ban");
            if (done) return;
        }



        // -------------------------
        // Total Links Block target duration flows (warn/mute/ban) - helper
        // -------------------------
        const handleSaveLinksBlockDuration = async (sessionKey, penaltyValue, successLabel) => {
            const session = ctx.session?.[sessionKey];
            if (!session) return false;

            const { chatIdStr, userId, promptMessage } = session;
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) { delete ctx.session[sessionKey]; return true; }

            const rawInput = (ctx.message.text || "").trim();
            if (!rawInput) { await ctx.reply("❌ Invalid input."); return true; }

            const totalSeconds = parseDurationToSeconds(rawInput);
            if (totalSeconds === null) { await ctx.reply("❌ Couldn't parse duration."); return true; }

            const MIN = 30, MAX = 365 * 24 * 3600;
            if (totalSeconds < MIN) { await ctx.reply("❌ Duration is too short. Minimum is 30 seconds."); return true; }
            if (totalSeconds > MAX) { await ctx.reply("❌ Duration is too long. Maximum is 365 days."); return true; }

            const ms = totalSeconds * 1000;
            try {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration_str`]: rawInput,
                            [`settings.${chatIdStr}.anti_spam.links_block.penalty_duration`]: ms,
                            [`settings.${chatIdStr}.anti_spam.links_block.penalty`]: penaltyValue
                        }
                    },
                    { upsert: true }
                );
            } catch (e) {
                console.error("DB error saving total links duration:", e);
                await ctx.reply("❌ Failed to save duration.");
                delete ctx.session[sessionKey];
                return true;
            }

            if (promptMessage?.chatId && promptMessage?.messageId) {
                try { await bot.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
            }

            delete ctx.session[sessionKey];
            await ctx.reply(`✅ Total links ${successLabel} duration saved: ${rawInput}`);
            await renderLinksBlockMenu(ctx, chatIdStr, userId, chat);
            return true;
        };

        if (ctx.session?.awaitingLinksWarnDuration) {
            const done = await handleSaveLinksBlockDuration("awaitingLinksWarnDuration", "warn", "warn");
            if (done) return;
        }
        if (ctx.session?.awaitingLinksMuteDuration) {
            const done = await handleSaveLinksBlockDuration("awaitingLinksMuteDuration", "mute", "mute");
            if (done) return;
        }
        if (ctx.session?.awaitingLinksBanDuration) {
            const done = await handleSaveLinksBlockDuration("awaitingLinksBanDuration", "ban", "ban");
            if (done) return;
        }

        // fallback
        if (typeof next === "function") {
            await next();
        }
    });
};