require('dotenv').config();
const { session } = require('telegraf');
const startButton = require('./buttons/userStartButton');
const bot_addded_by_user_listner = require('./helpers/bot_added_by_user_listner');
const manage_groups_or_channels_action = require('./actions/manage_groups_or_channels');
const go_back_to_start_action = require('./actions/go_back_to_start');
const groupSettings_action = require('./actions/groupSettings');
const check_then_transfer_group_or_channel = require('./helpers/check_then_transfer_group_or_channel');
const set_regulation_action = require('./actions/set_regulation');
const button_actions = require('./actions/buttons');
const anti_spam_action = require('./actions/anti_spam');
const anti_spam_Group = require('./actions/anti_spam_Group');
const set_welcome_action = require('./actions/setWelcome');
const set_welcome_Group = require('./actions/setWelcome_Group');
const anti_flood_action = require('./actions/anti_flood');
const anti_flood_Group = require('./actions/anti_flood_Group');
const set_good_bye_action = require('./actions/setGood_bye');
const set_goodbye_Group = require('./actions/setGoodbye_Group')
const alphabets_Group = require('./actions/alphabets');
const alphabets_action = require('./actions/alphabets_Group');
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
const masked_users_action = require('./actions/masked_users');
const personal_commands_action = require('./actions/personal_commands');
const find_groups_and_chanenls_action = require('./actions/find_groups_and_chanenls');
const auto_message_delete_cron = require('./cron/auto_message_delete')
const cleanup_panaltyed_users_cron = require('./cron/cleanup_panaltyed_users')

module.exports = (bot) => {
    auto_message_delete_cron(bot, { intervalMs: 60 * 1000 }) // start the cron job for auto deleting messages
    cleanup_panaltyed_users_cron(bot, { intervalMs: 60 * 1000 }) // start the cron job for auto deleting messages

    // Middleware to handle sessions and scenes
    bot.use(session());

    anti_flood_Group(bot)
    anti_spam_Group(bot)
    set_welcome_Group(bot)
    button_actions(bot)
    find_groups_and_chanenls_action(bot)
    set_goodbye_Group(bot)
    alphabets_Group(bot)

    // Start command handler
    bot.command('start', async (ctx) => {
        const chatType = ctx.chat?.type;
        if (chatType === 'private') return startButton(ctx);

        if (chatType !== 'group' && chatType !== 'supergroup') return;

        const text = ctx.message?.text || '';
        const entities = ctx.message?.entities || [];

        // Find the actual /start command entity
        const cmdEnt = entities.find(e => e.type === 'bot_command' && e.offset === 0);
        if (!cmdEnt) return;

        const cmdText = text.slice(cmdEnt.offset, cmdEnt.offset + cmdEnt.length); // like "/start@MyBot" 

        // If user wrote /start without @mention in group, ignore (optional)
        const expected = String(process.env.BOT_USERNAME_GROUP_HELP_ADVANCE || '').replace(/^@/, '');
        const m = cmdText.match(/^\/start(?:@([A-Za-z0-9_]+))?$/);

        const mentioned = (m && m[1]) ? m[1] : null;
        if (!mentioned || mentioned.toLowerCase() !== expected.toLowerCase()) {
            return; // not targeted to this bot
        }

        // Now verify bot is admin (your function)
        return check_then_transfer_group_or_channel(ctx);
    });

    // action handlers
    bot_addded_by_user_listner(bot)
    manage_groups_or_channels_action(bot)
    go_back_to_start_action(bot)
    groupSettings_action(bot)
    set_regulation_action(bot)
    anti_spam_action(bot)
    set_welcome_action(bot)
    anti_flood_action(bot)
    set_good_bye_action(bot)
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
    masked_users_action(bot)
    personal_commands_action(bot)
}