require('dotenv').config();
const { Markup, Scenes, session } = require('telegraf');
const startButton = require('./buttons/userStartButton');
const bot_addded_by_user_listner = require('./helpers/bot_added_by_user_listner');
const manage_groups_or_channels_action = require('./actions/manage_groups_or_channels');
const go_back_to_start_action = require('./actions/go_back_to_start');
const groupSettings_action = require('./actions/groupSettings');
const check_then_transfer_group_or_channel = require('./helpers/check_then_transfer_group_or_channel');
const set_regulation_action = require('./actions/set_regulation');
const button_actions = require('./actions/buttons');
const anti_spam_action = require('./actions/anti_spam');
const set_welcome_action = require('./actions/setWelcome');
const anti_flood_action = require('./actions/anti_flood');
const good_bye_action = require('./actions/good_bye');
const alphabets_action = require('./actions/alphabets');
const captcha_action = require('./actions/captcha')
const checks_action = require('./actions/checks')
const admin_sos_action = require('./actions/admin_sos')
const block_action = require('./actions/blocks')
const media_action = require('./actions/media');
const porn_action = require('./actions/porn')
const warns_action = require('./actions/warns');
const nightmode_action = require('./actions/nightmode');
const time_zone_action = require('./actions/time_zone');
const approval_mode_action = require('./actions/approval_mode');
const delete_messages_action = require('./actions/delete_messages');
const language_action = require('./actions/language');
const bannedWords_action = require('./actions/banned_words');
const recurring_messages_action = require('./actions/recurring_messages');
const members_management_action = require('./actions/members_management');
const message_length_action = require('./actions/message_length');

module.exports = (bot) => {
    // Middleware to handle sessions and scenes
    bot.use(session());
    // const stage = new Scenes.Stage([]);
    // bot.use(stage.middleware());

    // Start command handler
    bot.start(async (ctx) => {
        if (ctx.chat.type === 'private') {
            startButton(ctx)
        }
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
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
    bot_addded_by_user_listner(bot)
    manage_groups_or_channels_action(bot)
    go_back_to_start_action(bot)
    groupSettings_action(bot)
    set_regulation_action(bot)
    button_actions(bot)
    anti_spam_action(bot)
    set_welcome_action(bot)
    anti_flood_action(bot)
    good_bye_action(bot)
    alphabets_action(bot)
    captcha_action(bot)
    checks_action(bot)
    admin_sos_action(bot)
    block_action(bot)
    media_action(bot)
    porn_action(bot)
    warns_action(bot)
    nightmode_action(bot)
    time_zone_action(bot)
    approval_mode_action(bot)
    delete_messages_action(bot)
    language_action(bot)
    bannedWords_action(bot)
    recurring_messages_action(bot)
    members_management_action(bot)
    message_length_action(bot)
}