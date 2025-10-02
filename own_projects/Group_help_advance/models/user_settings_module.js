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
        },

        penalty_duration_str: {
            type: String,
            default: "10 minutes"
        },
        penalty_duration: {
            type: Number,
            default: 10 * 60 * 1000, // 10 minutes in ms
            min: 30 * 1000,          // minimum 30 seconds in ms
            max: 365 * 24 * 3600 * 1000 // maximum 365 days in ms
        }
    },

    forwarding: {
        channels: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: {
                type: Number,
                default: 10 * 60 * 1000, // 10 minutes in ms
                min: 30 * 1000,
                max: 365 * 24 * 3600 * 1000
            },
            delete_messages: { type: Boolean, default: false }
        },
        groups: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: {
                type: Number,
                default: 10 * 60 * 1000,
                min: 30 * 1000,
                max: 365 * 24 * 3600 * 1000
            },
            delete_messages: { type: Boolean, default: false }
        },
        users: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: {
                type: Number,
                default: 10 * 60 * 1000,
                min: 30 * 1000,
                max: 365 * 24 * 3600 * 1000
            },
            delete_messages: { type: Boolean, default: false }
        },
        bots: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: {
                type: Number,
                default: 10 * 60 * 1000,
                min: 30 * 1000,
                max: 365 * 24 * 3600 * 1000
            },
            delete_messages: { type: Boolean, default: false }
        },
        whitelist: {
            type: [String],
            default: []
        }
    },

    quote: {
        channels: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            delete_messages: { type: Boolean, default: false }
        },
        groups: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            delete_messages: { type: Boolean, default: false }
        },
        users: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            delete_messages: { type: Boolean, default: false }
        },
        bots: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            delete_messages: { type: Boolean, default: false }
        },
        whitelist: { type: [String], default: [] }
    },

    links_block: {
        penalty: {
            type: String,
            enum: ["off", "warn", "kick", "mute", "ban"],
            default: "off"
        },
        delete_messages: {
            type: Boolean,
            default: false
        },
        // Unified duration fields for warn/mute/ban (ms + human string)
        penalty_duration_str: {
            type: String,
            default: "10m"
        },
        penalty_duration: {
            type: Number,
            default: 10 * 60 * 1000,         // 10 minutes in ms
            min: 30 * 1000,                  // minimum 30 seconds in ms
            max: 365 * 24 * 3600 * 1000      // maximum 365 days in ms
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
    penalty_duration_str: {
        type: String,
        default: "10 minutes"
    },
    penalty_duration: { type: Number, default: 10 } // in minutes, if penalty is mute
});

// for alphabets settings
const singleLangSchema = new mongoose.Schema({
    penalty: {
        type: String,
        enum: ["off", "warn", "kick", "mute", "ban"],
        default: "off"
    },
    // minutes
    penalty_duration: {
        type: Number,
        default: 10
    },
    penalty_duration_str: {
        type: String,
        default: "10 minutes"
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

// for captcha settings
const captchaSchema = new mongoose.Schema({
    enabled: {
        type: Boolean,
        default: false
    },
    time: {
        type: Number,
        default: 3
    },
    penalty: {
        type: String,
        enum: ["off", "warn", "kick", "mute", "ban"],
        default: "mute"
    },
    mute_duration: {
        type: Number,
        default: 10
    },
    mode: {
        type: String,
        enum: ["button", "recaptcha", "presentation", "regulation", "math", "quiz"],
        default: "quiz"
    },
    delete_service_message: {
        type: Boolean,
        default: false
    },
    question: {
        type: String,
        default: ""
    },
    topic: {
        type: String,
        default: ""
    },
    message: {
        type: String,
        default: ""
    },
    button_text: {
        type: String,
        default: ""
    },
}, { _id: false });

// for checks settings
const checksSchema = new mongoose.Schema({
    obligations: {
        surname: { type: Boolean, default: false },
        username: { type: Boolean, default: false },
        profile_picture: { type: Boolean, default: false },
        channel_obligation: { type: Boolean, default: false },
        obligation_to_add: { type: Boolean, default: false }
    },
    name_blocks: {
        arabic: { type: Boolean, default: false },
        chinese: { type: Boolean, default: false },
        russian: { type: Boolean, default: false },
        spam: { type: Boolean, default: false }
    },
    check_at_join: { type: Boolean, default: false },
    delete_messages: { type: Boolean, default: false }
}, { _id: false });

// for admin_sos settings
const admin_sosSchema = new mongoose.Schema({
    // where to send reports: nobody | founder | staff
    send_to: { type: String, enum: ["nobody", "founder", "staff"], default: "nobody" },
    // whether the @admin/report feature is active or disabled
    active: { type: Boolean, default: true },
    // tag founder when reporting
    tag_founder: { type: Boolean, default: false },
    // array of admin ids to tag (store as strings for safety)
    tagged_admins: { type: [String], default: [] },
    // optional: staff group link or id to send reports to
    staff_group: { type: String, default: null },

    // --- Advanced options (new) ---
    // Only accept @admin if used as a reply to another user's message
    only_in_reply: { type: Boolean, default: false },

    // Require a reason (text) when using @admin
    reason_required: { type: Boolean, default: false },

    // If report is marked resolved, delete the report message(s)
    delete_if_resolved: { type: Boolean, default: false },

    // If report resolved, delete the report message in staff group (if sent there)
    delete_in_staff_if_resolved: { type: Boolean, default: false },

    // optional: extra flags (future use)
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

// for blocks settings
const blocksSchema = new mongoose.Schema({
    blacklist: {
        type: new mongoose.Schema({
            enabled: { type: Boolean, default: false },
            punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "ban" },
            mute_duration: { type: Number, default: 10 },
            mute_duration_str: { type: String, default: "10m" },
            users: { type: [String], default: [] },
        }, { _id: false }),
        default: () => ({})
    },

    // Generic block template used for several block types (botblock, joinblock, leaveblock, joinleave)
    botblock: {
        type: new mongoose.Schema({
            enabled: { type: Boolean, default: false },
            punishment: { type: String, enum: ["warn", "kick", "mute", "ban"], default: "" },
            mute_duration: { type: Number, default: 10 },
            mute_duration_str: { type: String, default: "10m" },
            users: { type: [String], default: [] },
        }, { _id: false }),
        default: () => ({})
    },

    joinblock: {
        type: new mongoose.Schema({
            enabled: { type: Boolean, default: false },
            punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            mute_duration: { type: Number, default: 10 },
            mute_duration_str: { type: String, default: "10m" },
            users: { type: [String], default: [] },
        }, { _id: false }),
        default: () => ({})
    },

    leaveblock: {
        type: new mongoose.Schema({
            enabled: { type: Boolean, default: false },
            punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            mute_duration: { type: Number, default: 10 },
            mute_duration_str: { type: String, default: "10m" },
            users: { type: [String], default: [] },
        }, { _id: false }),
        default: () => ({})
    },

    joinleave: {
        type: new mongoose.Schema({
            enabled: { type: Boolean, default: false },
            punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            mute_duration: { type: Number, default: 10 },
            mute_duration_str: { type: String, default: "10m" },
            users: { type: [String], default: [] },
        }, { _id: false }),
        default: () => ({})
    },

    multiple_joins: {
        type: new mongoose.Schema({
            enabled: { type: Boolean, default: false },
            punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            mute_duration: { type: Number, default: 10 },
            mute_duration_str: { type: String, default: "10m" },
            users: { type: [String], default: [] },
        }, { _id: false }),
        default: () => ({})
    }

}, { _id: false });

// Settings schema (key = chatId, value = regulationSchema wrapper)
const settingsSchema = new mongoose.Schema(
    {
        setregulation_message: regulationSchema,
        anti_spam: anti_spamSchema,
        welcome: welcome_and_goodbye_Schema,
        anti_flood: anti_floodSchema,
        goodbye: welcome_and_goodbye_Schema,
        alphabets: alphabetsSchema,
        captcha: captchaSchema,
        checks: checksSchema,
        admin_sos: admin_sosSchema,
        blocks: blocksSchema,
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

let user_setting_module;
if (group_help_advance_connection) {
    user_setting_module = group_help_advance_connection.model(
        "user_settings",
        userSchema
    )
}

module.exports = user_setting_module;