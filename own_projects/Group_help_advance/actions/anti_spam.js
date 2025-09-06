const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

async function renderTgLinksMenu(ctx, chatIdStr, userId) {
    // DB se settings fetch karo
    const userSettings = await user_setting_module.findOne({ user_id: userId });
    const tgLinks = userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links || {};

    const penalty = tgLinks.penalty || "off";
    const penaltyLabel = penalty.charAt(0).toUpperCase() + penalty.slice(1);

    const deleteMessages = tgLinks.delete_messages ? "✅" : "❌";
    const usernameAntispam = tgLinks.username_antispam ? "✅" : "❌";

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback("❌ Off", `TGLINKS_OFF_${chatIdStr}`),
            Markup.button.callback("⚠ Warn", `TGLINKS_WARN_${chatIdStr}`),
            Markup.button.callback("🚪 Kick", `TGLINKS_KICK_${chatIdStr}`)
        ],
        [
            Markup.button.callback("🔇 Mute", `TGLINKS_MUTE_${chatIdStr}`),
            Markup.button.callback("⛔ Ban", `TGLINKS_BAN_${chatIdStr}`)
        ],
        [Markup.button.callback(`🗑 Delete Messages ${deleteMessages}`, `TGLINKS_DELETE_${chatIdStr}`)],
        [Markup.button.callback(`🎯 Username Antispam ${usernameAntispam}`, `TGLINKS_USERNAME_${chatIdStr}`)],
        [
            Markup.button.callback("⭐ Exceptions", `TGLINKS_EXCEPTIONS_${chatIdStr}`)
        ],
        [
            Markup.button.callback("⬅️ Back", `SET_ANTISPAM_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]
    ]);


    const text =
        "📘 Telegram links\n" +
        "This menu lets you control how Telegram links (users, channels, groups, bots) are handled.\n\n\n" +
        "⚙️ <b>How it works:</b>\n" +
        "• If a user sends any Telegram link (User / Channel / Group / Bot)\nthe selected <b>Penalty</b> will be applied.\n\n" +
        "• If <b>Deletion</b> is ON\nthe message will also be deleted.\n\n" +
        "• If <b>Username</b> is ON\nusernames (like <code>@example</code>) are also checked and punished using the same <b>Penalty</b>. If <b>Deletion</b> is ON, such messages are also deleted.\n\n" +
        "• If <b>Penalty</b> is OFF but <b>Deletion</b> is ON\nonly the message is deleted (no punishment).\n\n\n" +
        `<b>Penalty:</b> ${penaltyLabel}\n` +
        `<b>Deletion:</b> ${deleteMessages}\n` +
        `<b>Username:</b> ${usernameAntispam}`;

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: keyboard.reply_markup
    });
}

function normalizeAndValidateEntry(raw) {
    if (!raw) return null;
    let s = raw.trim();

    // strip surrounding braces [] {} if user used them
    s = s.replace(/^[\{\[]+/, "").replace(/[\}\]]+$/, "").trim();

    // If it's an @username:
    if (/^@[\w\d_]{5,}$/i.test(s)) return `@${s.replace(/^@/, "")}`;

    // If it's t.me/ or https:// or http:// or www.
    if (/^(https?:\/\/|t\.me\/|www\.)/i.test(s)) {

        // normalize @username
        if (/^@/.test(s)) return `@${s.replace(/^@/, "")}`;

        // normalize t.me links
        if (/^https?:\/\/t\.me\/([\w\d_]{5,})$/i.test(s)) return s; // valid t.me/@username
        if (/^t\.me\/([\w\d_]{5,})$/i.test(s)) return `https://${s}`;

        // if t.me/ without username, invalid
        if (/^t\.me\/?$/i.test(s)) return null;

        // other URLs
        if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
        return s;
    }

    // bare domain like "link.com" -> convert to https://link.com
    if (/^[a-z0-9\-\_]+\.[a-z]{2,}(\.[a-z]{2,})?$/i.test(s)) {
        return `https://${s}`;
    }

    // fallback: not valid
    return null;
}

module.exports = (bot) => {
    bot.action(/SET_ANTISPAM_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr); // string → number
        const userId = ctx.from.id;       // current user id

        const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!isOwner) return;

        const text = "🛡 Anti-Spam\nIn this menu you can decide whether to protect your groups from unnecessary links, forwards, and quotes.";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("📘 Telegram links / username", `ANTISPAM_TGLINKS_${chatIdStr}`)],
            [
                Markup.button.callback("📩 Forwarding", `ANTISPAM_FORWARD_${chatIdStr}`),
                Markup.button.callback("☁ Quote", `ANTISPAM_QUOTE_${chatIdStr}`)
            ],
            [Markup.button.callback("🔗 Total links block", `ANTISPAM_BLOCK_${chatIdStr}`)],
            [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
        ]);

        await safeEditOrSend(ctx, text, keyboard);
    });

    bot.action(/ANTISPAM_TGLINKS_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        // ✅ Owner validation
        const isOwner = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!isOwner) {
            return ctx.answerCbQuery("❌ You are not authorized to access Telegram links settings.", { show_alert: true });
        }

        renderTgLinksMenu(ctx, chatIdStr, userId);
    });

    // --- PENALTY HANDLERS ---
    bot.action(/TGLINKS_(OFF|WARN|KICK|MUTE|BAN)_(.+)/, async (ctx) => {
        const [, action, chatIdStr] = ctx.match;
        const userId = ctx.from.id;
        const chatId = Number(chatIdStr);

        if (!(await validateOwner(ctx, chatId, chatIdStr, userId))) return;

        await user_setting_module.findOneAndUpdate(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.anti_spam.telegram_links.penalty`]: action.toLowerCase() } },
            { upsert: true, setDefaultsOnInsert: true }
        );

        await ctx.answerCbQuery(`✅ Penalty set to: ${action}`);
        await renderTgLinksMenu(ctx, chatIdStr, userId);  // <-- update message
    });

    // --- DELETE MESSAGES TOGGLE ---
    bot.action(/TGLINKS_DELETE_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const chatId = Number(chatIdStr);

        if (!(await validateOwner(ctx, chatId, chatIdStr, userId))) return;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const currentValue = userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links?.delete_messages || false;
        const newValue = !currentValue;

        await user_setting_module.findOneAndUpdate(
            { user_id: userId },
            { $set: { [`settings.${chatIdStr}.anti_spam.telegram_links.delete_messages`]: newValue } },
            { upsert: true }
        );

        await ctx.answerCbQuery(`🗑 Delete Messages ${newValue ? "enabled ✔" : "disabled ✖"}`);
        await renderTgLinksMenu(ctx, chatIdStr, userId);  // <-- update message
    });

    // --- USERNAME ANTISPAM TOGGLE ---
    bot.action(/TGLINKS_USERNAME_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const chatId = Number(chatIdStr);

        if (!(await validateOwner(ctx, chatId, chatIdStr, userId))) return;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const currentValue =
            userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links?.username_antispam || false;

        const newValue = !currentValue;

        await user_setting_module.findOneAndUpdate(
            { user_id: userId },
            {
                $set: {
                    [`settings.${chatIdStr}.anti_spam.telegram_links.username_antispam`]: newValue
                }
            },
            { upsert: true }
        );

        await ctx.answerCbQuery(
            `🎯 Username Antispam ${newValue ? "enabled ✔" : "disabled ✖"}`
        );

        // 🔄 message update
        await renderTgLinksMenu(ctx, chatIdStr, userId);
    });

    // --- TG LINKS EXCEPTIONS MENU ---
    bot.action(/TGLINKS_EXCEPTIONS_(.+)/, async (ctx) => {
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
            "📘 <b>Antispam Exception</b>\n\n" +
            "Here you can manage the Telegram links or usernames that will <b>not be treated as spam</b>.\n\n" +
            "📄 View your whitelist\n" +
            "➕ Add new entries\n" +
            "➖ Remove existing ones\n" +
            "🌍 Manage the global whitelist";

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard
        });
    });

    // --- SHOW WHITELIST ---
    bot.action(/TGLINKS_SHOWWL_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;

        const userSettings = await user_setting_module.findOne({ user_id: userId });
        const whitelist = userSettings?.settings?.get(chatIdStr)?.anti_spam?.telegram_links?.whitelist || [];

        const listText = whitelist.length > 0
            ? whitelist.map((item, i) => `${i + 1}. ${item}`).join("\n")
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

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
    });

    // ACTION: when user clicked "Add from whitelist"
    bot.action(/TGLINKS_ADDWL_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        // ensure owner
        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➕ <b>Add to Whitelist</b>\n\n" +
            "Send one or more Telegram links or @usernames of channels/groups to add them to the whitelist.\n\n" +
            "👉 Send each link/username on a new line (without extra symbols), or forward a message from the channel/group you want to add.\n\n" +
            "<b>Example:</b>\n@GroupHelp\nhttps://t.me/joinchat/AAAAAEJxVruWWN-0mma-ew";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `TGLINKS_EXCEPTIONS_${chatIdStr}`)]
        ]);

        // set session awaiting flag
        ctx.session = ctx.session || {};
        ctx.session.awaitingWhitelistAdd = { chatIdStr, userId };

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        });
    });

    // ACTION: when user clicked "Remove from whitelist"
    bot.action(/TGLINKS_REMOVEWL_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;

        // ensure owner
        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;

        const text =
            "➖ <b>Remove from Whitelist</b>\n\n" +
            "Send one or more Telegram links or @usernames of channels/groups to remove them from the whitelist.\n\n" +
            "👉 Send each link/username on a new line (without extra symbols), or forward a message from the channel/group you want to remove.\n\n" +
            "<b>Example:</b>\n@GroupHelp\nhttps://t.me/joinchat/COVT7z7KD0sN8kZpJg60Ug";

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", `TGLINKS_EXCEPTIONS_${chatIdStr}`)]
        ]);

        // set session awaiting flag
        ctx.session = ctx.session || {};
        ctx.session.awaitingWhitelistRemove = { chatIdStr, userId };

        await safeEditOrSend(ctx, text, {
            parse_mode: "HTML",
            reply_markup: keyboard.reply_markup
        });
    });

    // TEXT HANDLER: handles both add & remove flows
    bot.on("text", async (ctx, next) => {
        ctx.session = ctx.session || {};

        // ===== ADD FLOW =====
        if (ctx.session.awaitingWhitelistAdd) {
            const { chatIdStr, userId } = ctx.session.awaitingWhitelistAdd;

            // validate owner
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                delete ctx.session.awaitingWhitelistAdd;
                return;
            }

            const inputText = (ctx.message.text || "").trim();
            const entries = []; // valid entries
            const invalid = []; // invalid lines

            // Handle forwarded messages
            if (ctx.message.forward_from_chat) {
                const fc = ctx.message.forward_from_chat;
                if (fc.username) entries.push(`@${fc.username}`);
                else entries.push(`https://t.me/c/${Math.abs(fc.id)}`);
            } else if (ctx.message.forward_from) {
                const fu = ctx.message.forward_from;
                if (fu.username) entries.push(`@${fu.username}`);
                else entries.push(`tg://user?id=${fu.id}`);
            } else {
                // parse multiple lines
                const lines = inputText.split("\n").map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                    const norm = normalizeAndValidateEntry(line);
                    console.log("norm", norm);
                    if (norm) entries.push(norm);
                    else invalid.push(line);
                }
            }

            if (!entries.length) {
                await safeEditOrSend(ctx,
                    "❌ No valid usernames/links found. Please send usernames (e.g. @GroupHelp) or links (https://t.me/...) each on a new line.",
                    { parse_mode: "HTML" }
                );
                return;
            }

            try {
                // Step 1: Ensure parent object exists
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $setOnInsert: { user_id: userId },
                        $set: {
                            [`settings.${chatIdStr}.anti_spam.telegram_links.penalty`]: "off",
                            [`settings.${chatIdStr}.anti_spam.telegram_links.delete_messages`]: false,
                            [`settings.${chatIdStr}.anti_spam.telegram_links.username_antispam`]: false,
                            [`settings.${chatIdStr}.anti_spam.telegram_links.whitelist`]: []
                        }
                    },
                    { upsert: true }
                );

                // Step 2: Add entries to whitelist
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $addToSet: {
                            [`settings.${chatIdStr}.anti_spam.telegram_links.whitelist`]: { $each: entries }
                        }
                    }
                );
            } catch (err) {
                console.error("Error adding to whitelist:", err);
                await ctx.reply("⚠️ Something went wrong while saving. Try again later.");
                delete ctx.session.awaitingWhitelistAdd;
                return;
            }

            // Reply to user
            const okList = entries.map(e => `• ${e}`).join("\n");
            const invalidList = invalid.length ? `\n\nInvalid lines (not added):\n${invalid.map(i => `• ${i}`).join("\n")}` : "";

            const replyText = `✅ <b>Added to whitelist</b> for <b>${chat.title || chatIdStr}</b>:\n\n${okList}${invalidList}`;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("⬅️ Back", `TGLINKS_EXCEPTIONS_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ]);

            await ctx.reply(replyText, { parse_mode: "HTML", ...keyboard });
            delete ctx.session.awaitingWhitelistAdd;
            return;
        }

        // ===== REMOVE FLOW =====
        if (ctx.session.awaitingWhitelistRemove) {
            const { chatIdStr, userId } = ctx.session.awaitingWhitelistRemove;

            // validate owner
            const chat = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!chat) {
                delete ctx.session.awaitingWhitelistRemove;
                return;
            }

            const inputText = (ctx.message.text || "").trim();
            const toRemove = [];
            const invalid = [];

            // Handle forwarded messages
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
                    const norm = normalizeAndValidateEntry(line);
                    if (norm) toRemove.push(norm);
                    else invalid.push(line);
                }
            }

            if (!toRemove.length) {
                await safeEditOrSend(ctx,
                    "❌ No valid usernames/links found to remove. Please send valid usernames (e.g. @GroupHelp) or links each on a new line.",
                    { parse_mode: "HTML" }
                );
                return;
            }

            try {
                // Remove from whitelist
                await user_setting_module.updateOne(
                    { user_id: userId },
                    {
                        $pull: {
                            [`settings.${chatIdStr}.anti_spam.telegram_links.whitelist`]: { $in: toRemove }
                        }
                    }
                );
            } catch (err) {
                console.error("Error removing from whitelist:", err);
                await ctx.reply("⚠️ Something went wrong while removing. Try again later.");
                delete ctx.session.awaitingWhitelistRemove;
                return;
            }

            // Reply to user
            const removedList = toRemove.map(e => `• ${e}`).join("\n");
            const invalidList = invalid.length ? `\n\nInvalid lines (not processed):\n${invalid.map(i => `• ${i}`).join("\n")}` : "";

            const replyText = `✅ <b>Removed from whitelist</b> for <b>${chat.title || chatIdStr}</b>:\n\n${removedList}${invalidList}`;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback("⬅️ Back", `TGLINKS_EXCEPTIONS_${chatIdStr}`)],
                [Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
            ]);

            await ctx.reply(replyText, { parse_mode: "HTML", ...keyboard });
            delete ctx.session.awaitingWhitelistRemove;
            return;
        }
        next()
    });

    bot.action(/ANTISPAM_FORWARD_(.+)/, async (ctx) => {
        const chatIdStr = ctx.match[1];

        const text = `📨 <b>Forwarding</b>\n\nSelect punishment for users who forward messages in the group.\n\nForward from groups option blocks messages written by an anonymous administrator of another group and forwarded to this group.`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: "📣 Channels", callback_data: `FORWARD_CHANNELS_${chatIdStr}` },
                    { text: "👥 Groups", callback_data: `FORWARD_GROUPS_${chatIdStr}` }
                ],
                [
                    { text: "👤 Users", callback_data: `FORWARD_USERS_${chatIdStr}` },
                    { text: "🤖 Bots", callback_data: `FORWARD_BOTS_${chatIdStr}` }
                ],
                [{ text: "🌟 Exceptions", callback_data: `ANTISPAM_FORWARD_EXCEPTIONS_${chatIdStr}` }],
                [
                    { text: "⬅️ Back", callback_data: `SET_ANTISPAM_${chatIdStr}` },
                    { text: "🏠 Main Menu", callback_data: `GROUP_SETTINGS_${chatIdStr}` },
                ]
            ]
        };

        await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
    });

    
};
