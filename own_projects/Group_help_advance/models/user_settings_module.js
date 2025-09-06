const mongoose = require("mongoose");
const { group_help_advance_connection } = require("../../../globle_helper/mongoDB_connection");

// for regulation settings
const regulationSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        text: { type: String },
        media: { type: String }, // Telegram file_id
        media_type: {
            type: String,
            enum: ["photo", "video", "document", null],
            default: null,
        },
        buttons: {
            type: [
                [
                    {
                        text: { type: String, required: true },
                        content: { type: String, required: true },
                    },
                ],
            ], // Array of array of button objects (rows)
            default: [],
        },
    },
    { _id: false } // agar aap embed kar rahe ho parent schema me
);

// for anti-spam settings
const anti_spamSchema = new mongoose.Schema({
    telegram_links: {
        penalty: {
            type: String,
            enum: ["off", "warn", "kick", "mute", "ban"],
            default: "off"
        },
        delete_messages: {
            type: Boolean,
            default: false
        },
        username_antispam: {
            type: Boolean,
            default: false
        },
        whitelist: {
            type: [String],
            default: []
        }
    }
});


// Settings schema (key = chatId, value = regulationSchema wrapper)
const settingsSchema = new mongoose.Schema(
    {
        setregulation_message: regulationSchema,
        anti_spam: anti_spamSchema
    },
    { _id: false }
);

const userSchema = new mongoose.Schema(
    {
        user_id: { type: Number, required: true },
        groups_chat_ids: { type: [String], default: [] },
        channels_chat_ids: { type: [String], default: [] },

        // 👇 dynamic chatId keys stored here
        settings: {
            type: Map,
            of: settingsSchema,
            default: {},
        },
    },
    { timestamps: true }
);

const user_setting_module = group_help_advance_connection.model(
    "user_settings",
    userSchema
);

module.exports = user_setting_module;