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
    },
    forwarding: {
        channels: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            delete_messages: { type: Boolean, default: false }
        },
        groups: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            delete_messages: { type: Boolean, default: false }
        },
        users: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            delete_messages: { type: Boolean, default: false }
        },
        bots: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            delete_messages: { type: Boolean, default: false }
        },
        whitelist: {
            type: [String],
            default: []
        }
    }
});

// for welcome and goodbye message settings
const welcome_and_goodbye_Schema = new mongoose.Schema({
    enabled: {
        type: Boolean,
        default: false // on/off
    },
    mode: {
        type: String,
        enum: ["always", "first"], // always send or only first join
        default: "always"
    },
    delete_last: {
        type: Boolean,
        default: false // delete previous welcome msg
    },
    text: {
        type: String,
        default: "" // welcome message text
    },
    media: {
        type: String,
        default: "" // file_id or URL
    },
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
        ],
        default: []
    }
});

// for antiflood settings
const anti_floodSchema = new mongoose.Schema({
    penalty: {
        type: String,
        enum: ["off", "warn", "kick", "mute", "ban"],
        default: "off"
    },
    delete_messages: {
        type: Boolean,
        default: false
    },
    message_limit: { type: Number, default: 5 }, // messages allowed in time frame
    time_frame: { type: Number, default: 10 }, // in seconds
    mute_duration: { type: Number, default: 10 } // in minutes, if penalty is mute
});

// for alphabets settings
const singleLangSchema = new mongoose.Schema({
    penalty: {
        type: String,
        enum: ["off", "warn", "kick", "mute", "ban"],
        default: "off"
    },
    // minutes
    mute_duration: {
        type: Number,
        default: 10
    },
    mute_duration_str: {
        type: String,
        default: "10m"
    },
    delete_messages: {
        type: Boolean,
        default: false
    },
}, { _id: false });
const alphabetsSchema = new mongoose.Schema({
    arabic: { type: singleLangSchema, default: {} },
    cyrillic: { type: singleLangSchema, default: {} },
    chinese: { type: singleLangSchema, default: {} },
    latin: { type: singleLangSchema, default: {} }
}, { _id: false });

// Settings schema (key = chatId, value = regulationSchema wrapper)
const settingsSchema = new mongoose.Schema(
    {
        setregulation_message: regulationSchema,
        anti_spam: anti_spamSchema,
        welcome: welcome_and_goodbye_Schema,
        anti_flood: anti_floodSchema,
        goodbye: welcome_and_goodbye_Schema,
        alphabets: alphabetsSchema
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