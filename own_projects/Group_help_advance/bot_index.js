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
}