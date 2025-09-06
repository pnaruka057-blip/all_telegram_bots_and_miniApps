const check_then_transfer_group_or_channel = require("../helpers/check_then_transfer_group_or_channel");

module.exports = async (bot) => {
    bot.on("my_chat_member", (ctx) => check_then_transfer_group_or_channel(ctx));
};