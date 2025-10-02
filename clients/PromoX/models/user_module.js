const mongoose = require('mongoose');
const { promoX_connection } = require('../../../globle_helper/mongoDB_connection')

const telegramUserSchema = new mongoose.Schema({
    user_id: {
        type: Number,
        required: true,
        unique: true
    },
    first_name: {
        type: String,
        required: true
    },
    last_name: {
        type: String,
        default: ''
    },
    username: {
        type: String
    },
    allows_write_to_pm: {
        type: Boolean,
        default: false
    },
    photo_url: {
        type: String
    },
    is_channel_page_locked_date: {
        type: Date,
    },
    is_profile_page_locked: {
        type: Date,
    },
    is_group_page_locked_date: {
        type: Date,
    },
});

let user_module;
if(promoX_connection){
    user_module = promoX_connection.model('Telegram_user', telegramUserSchema)
}

module.exports = user_module