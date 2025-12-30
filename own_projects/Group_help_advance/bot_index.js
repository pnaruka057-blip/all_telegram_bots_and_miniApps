const { Markup, session } = require("telegraf");

const startButton = require("./buttons/userStartButton");

const bot_addded_by_user_listner = require("./helpers/bot_added_by_user_listner");

const manage_groups_or_channels_action = require("./actions/manage_groups_or_channels");

const go_back_to_start_action = require("./actions/go_back_to_start");

const groupSettings_action = require("./actions/groupSettings");

const check_then_transfer_group_or_channel = require("./helpers/check_then_transfer_group_or_channel");

const set_regulation_action = require("./actions/set_regulation");

const button_actions = require("./actions/buttons");

const anti_spam_action = require("./actions/anti_spam");

const anti_spam_Group = require("./actions/anti_spam_Group");

const set_welcome_action = require("./actions/setWelcome");

const set_welcome_Group = require("./actions/setWelcome_Group");

const anti_flood_action = require("./actions/anti_flood");

const good_bye_action = require("./actions/good_bye");

const alphabets_action = require("./actions/alphabets");

const captcha_action = require("./actions/captcha");

const checks_action = require("./actions/checks");

const admin_sos_action = require("./actions/admin_sos");

const block_action = require("./actions/blocks");

const media_action = require("./actions/media");

const porn_action = require("./actions/porn");

const warns_action = require("./actions/warns");

const nightmode_action = require("./actions/nightmode");

const time_zone_action = require("./actions/time_zone");

const approval_mode_action = require("./actions/approval_mode");

const delete_messages_action = require("./actions/delete_messages");

const language_action = require("./actions/language");

const bannedWords_action = require("./actions/banned_words");

const recurring_messages_action = require("./actions/recurring_messages");

const members_management_action = require("./actions/members_management");

const message_length_action = require("./actions/message_length");

const masked_users_action = require("./actions/masked_users");

const personal_commands_action = require("./actions/personal_commands");

const auto_message_delete_cron = require("./cron/auto_message_delete");

const verify_user_joined_channel = require("./helpers/verify_user_joined_channel");

function buildJoinUrlFromUsernameOrLink(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;

    if (/^https?:\/\//i.test(s)) return s;

    // username (without @) OR @username
    if (/^@?[A-Za-z0-9_]{5,32}$/.test(s)) {
        const u = s.startsWith("@") ? s.slice(1) : s;
        return `https://t.me/${u}`;
    }

    return null;
}

module.exports = (bot) => {
    auto_message_delete_cron(bot, { intervalMs: 1 });

    // session must be before middleware (we use ctx.session for rate-limit)
    bot.use(session());

    // -------------------------------------------------------------------
    // ✅ Official channel join gate (ENV without @ supported)
    // -------------------------------------------------------------------
    const OFFICIAL_RAW = process.env.GROUP_HELP_ADVANCE_TELEGRAM_CHANNEL_USER_MUST_JOIN 
    const OFFICIAL_JOIN_URL = buildJoinUrlFromUsernameOrLink(OFFICIAL_RAW);

    // Re-check join button
    bot.action("CHECK_OFFICIAL_JOIN_GATE", async (ctx) => {
        try {
            if (!OFFICIAL_RAW) {
                await ctx.answerCbQuery("Join setting missing in env.", { show_alert: true });
                return;
            }

            const ok = await verify_user_joined_channel(ctx, OFFICIAL_RAW, ctx.from.id);
            if (!ok) {
                await ctx.answerCbQuery("Still not joined. Please join first.", { show_alert: true });
                return;
            }

            await ctx.answerCbQuery("Verified ✅ You can use admin features now.");
            try {
                await ctx.editMessageText("✅ Verified! Now you can use bot admin features.");
            } catch (e) { }
        } catch (e) {
            try {
                await ctx.answerCbQuery("Could not verify right now. Try again.", { show_alert: true });
            } catch (_) { }
        }
    });

    // Main gate middleware
    bot.use(async (ctx, next) => {
        try {
            if (!OFFICIAL_RAW || !OFFICIAL_JOIN_URL) return next();
            if (!ctx.from?.id) return next();

            const chatType = ctx.chat?.type;
            const isPrivate = chatType === "private";
            const isGroup = chatType === "group" || chatType === "supergroup";
            const isCallback = !!ctx.callbackQuery;
            const isGroupCommand =
                isGroup && typeof ctx.message?.text === "string" && ctx.message.text.trim().startsWith("/");

            // Gate only: private chat, callback queries, group commands.
            if (!isPrivate && !isCallback && !isGroupCommand) return next();

            // Allow the join-check callback itself.
            if (ctx.callbackQuery?.data === "CHECK_OFFICIAL_JOIN_GATE") return next();

            // In group: only admins/creator are gated; normal users ignored silently.
            if (isGroup) {
                let member;
                try {
                    member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
                } catch (e) {
                    return next();
                }

                const isAdmin = member?.status === "administrator" || member?.status === "creator";
                if (!isAdmin) return next();
            }

            const joined = await verify_user_joined_channel(ctx, OFFICIAL_RAW, ctx.from.id);
            if (joined) return next();

            // Rate limit DM spam (10 minutes)
            ctx.session = ctx.session || {};
            const now = Date.now();
            if (ctx.session.__joinGateLastAt && now - ctx.session.__joinGateLastAt < 10 * 60 * 1000) {
                if (isCallback) {
                    try {
                        await ctx.answerCbQuery("Please join official channel first (check DM).", { show_alert: true });
                    } catch (_) { }
                }
                return; // block
            }
            ctx.session.__joinGateLastAt = now;

            // DM only (no group message)
            const dmText =
                "⚠️ Admin access required\n\n" +
                "To use this bot, you must first join our official channel.\n" +
                "After joining, come back and tap “✅ I Joined”.";

            const keyboard = Markup.inlineKeyboard([
                [Markup.button.url("📢 Join Official Channel", OFFICIAL_JOIN_URL)],
                [Markup.button.callback("✅ I Joined", "CHECK_OFFICIAL_JOIN_GATE")],
            ]);

            try {
                await ctx.telegram.sendMessage(ctx.from.id, dmText, keyboard);
            } catch (e) {
                // User has not started bot in private / blocked bot => can't DM.
            }

            if (isCallback) {
                try {
                    await ctx.answerCbQuery("Official channel join required. Check DM.", { show_alert: true });
                } catch (_) { }
            }

            return; // block
        } catch (e) {
            // fail-open
            return next();
        }
    });

    // existing registrations
    anti_spam_Group(bot);
    set_welcome_Group(bot);
    button_actions(bot);

    // Start
    bot.start(async (ctx) => {
        if (ctx.chat.type === "private") {
            startButton(ctx);
            return;
        }

        if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
            const text = ctx.message.text || "";
            if (text.startsWith("/start") && text.includes("@")) {
                const commandUsername = text.split("@")[1].trim();
                if (commandUsername === process.env.BOT_USERNAME_GROUP_HELP_ADVANCE) {
                    check_then_transfer_group_or_channel(ctx);
                }
            }
        }
    });

    // action handlers
    bot_addded_by_user_listner(bot);

    manage_groups_or_channels_action(bot);
    go_back_to_start_action(bot);
    groupSettings_action(bot);

    set_regulation_action(bot);
    anti_spam_action(bot);
    set_welcome_action(bot);

    anti_flood_action(bot);
    good_bye_action(bot);

    alphabets_action(bot);
    captcha_action(bot);
    checks_action(bot);

    admin_sos_action(bot);
    block_action(bot);

    media_action(bot);
    porn_action(bot);
    warns_action(bot);

    nightmode_action(bot);
    time_zone_action(bot);
    approval_mode_action(bot);

    delete_messages_action(bot);
    language_action(bot);
    bannedWords_action(bot);

    recurring_messages_action(bot);
    members_management_action(bot);
    message_length_action(bot);
    masked_users_action(bot);

    personal_commands_action(bot);
};