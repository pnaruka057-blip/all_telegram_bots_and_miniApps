// module.js  (ye hi file tum './module' se require kar rahe ho)
const mongoose = require("mongoose");
const { checker_gai_dep_connection } = require('../../globle_helper/mongoDB_connection');

// Schema define
const bot_user_info_Schema = new mongoose.Schema({
    user_id: {
        type: Number,
        required: true,
        unique: true,  // same user sirf ek baar
        index: true,
    },
    first_name: {
        type: String,
        default: '',
    },
    last_name: {
        type: String,
        default: '',
    },
    username: {
        type: String,
        default: '',
    },
    language_code: {
        type: String,
        default: '',
    },
    is_bot: {
        type: Boolean,
        default: false,
    },
    created_at: {
        type: Date,
        default: Date.now,
    },
});

// Model create
let bot_user_info_model;
if (checker_gai_dep_connection) {
    bot_user_info_model = checker_gai_dep_connection.model(
        "bot_user_info",
        bot_user_info_Schema
    );
}

module.exports = bot_user_info_model;