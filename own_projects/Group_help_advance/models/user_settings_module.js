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
        // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
        warned_users: {
            type: [{
                user_id: { type: Number, required: true },
                count: { type: Number, default: 1, min: 1, max: 3 },
            }],
            default: []
        },
        // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
        punished_users: {
            type: [{
                user_id: { type: Number, required: true },
                type: { type: String, enum: ["mute", "ban"], required: true },
                until_ms: { type: Number, required: true }  // Telegram until_date * 1000
            }],
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
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
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
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
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
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
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
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
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
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
            },
            delete_messages: { type: Boolean, default: false }
        },
        groups: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
            },
            delete_messages: { type: Boolean, default: false }
        },
        users: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
            },
            delete_messages: { type: Boolean, default: false }
        },
        bots: {
            penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
            penalty_duration_str: { type: String, default: "10 minutes" },
            penalty_duration: { type: Number, default: 10 * 60 * 1000, min: 30 * 1000, max: 365 * 24 * 3600 * 1000 },
            // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
            warned_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    count: { type: Number, default: 1, min: 1, max: 3 },
                }],
                default: []
            },
            // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
            punished_users: {
                type: [{
                    user_id: { type: Number, required: true },
                    type: { type: String, enum: ["mute", "ban"], required: true },
                    until_ms: { type: Number, required: true }  // Telegram until_date * 1000
                }],
                default: []
            },
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
        }, // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
        warned_users: {
            type: [{
                user_id: { type: Number, required: true },
                count: { type: Number, default: 1, min: 1, max: 3 },
            }],
            default: []
        },
        // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
        punished_users: {
            type: [{
                user_id: { type: Number, required: true },
                type: { type: String, enum: ["mute", "ban"], required: true },
                until_ms: { type: Number, required: true }  // Telegram until_date * 1000
            }],
            default: []
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
    is_pm_allowed: {
        type: Boolean,
        default: false
    },
    is_force_bot_start: {
        type: Boolean,
        default: false
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
    penalty_duration: {
        type: Number,
        default: 10 * 60 * 1000, // 10 minutes in ms
        min: 30 * 1000,          // minimum 30 seconds in ms
        max: 365 * 24 * 3600 * 1000 // maximum 365 days in ms
    },
    // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
    warned_users: {
        type: [{
            user_id: { type: Number, required: true },
            count: { type: Number, default: 1, min: 1, max: 3 },
        }],
        default: []
    },
    // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
    punished_users: {
        type: [{
            user_id: { type: Number, required: true },
            type: { type: String, enum: ["mute", "ban"], required: true },
            until_ms: { type: Number, required: true }  // Telegram until_date * 1000
        }],
        default: []
    },
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
        default: 10 * 60 * 1000, // 10 minutes in ms
        min: 30 * 1000,          // minimum 30 seconds in ms
        max: 365 * 24 * 3600 * 1000 // maximum 365 days in ms
    },
    penalty_duration_str: {
        type: String,
        default: "10 minutes"
    }, // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
    warned_users: {
        type: [{
            user_id: { type: Number, required: true },
            count: { type: Number, default: 1, min: 1, max: 3 },
        }],
        default: []
    },
    // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
    punished_users: {
        type: [{
            user_id: { type: Number, required: true },
            type: { type: String, enum: ["mute", "ban"], required: true },
            until_ms: { type: Number, required: true }  // Telegram until_date * 1000
        }],
        default: []
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
    time_str: {
        type: String,
        default: "10 minutes"
    },
    time: {
        type: Number,
        default: 10 * 60 * 1000, // 10 minutes in ms
        min: 30 * 1000,          // minimum 30 seconds in ms
        max: 365 * 24 * 3600 * 1000 // maximum 365 days in ms
    },
    penalty: {
        type: String,
        enum: ["kick", "mute", "ban"],
        default: "mute"
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

// for checks settings (updated)
const checksSchema = new mongoose.Schema({
    // Required conditions toggles
    force: {
        channel_join: { type: Boolean, default: false },
        member_add: { type: Boolean, default: false }
    },

    // profile penalties
    profile_penalties: {
        surname: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" },
        username: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" },
        profile_picture: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" },
    },

    force_channel_join: {
        channels: { type: [String], default: [] },
        message: { type: String, default: "" },      // custom prompt text
        media: {
            type: String,
            default: "" // file_id or URL
        },
        media_type: {
            type: String,
            enum: ["photo", "video", "document", null],
            default: null,
        },
    },

    force_add_member: {
        add_min: { type: Number, default: 0, min: 0, max: 10000 },
        add_message: { type: String, default: "" },     // custom prompt text
        media: {
            type: String,
            default: "" // file_id or URL
        },
        media_type: {
            type: String,
            enum: ["photo", "video", "document", null],
            default: null,
        },
    },

    // Name blocking toggles (legacy/visibility)
    name_blocks: {
        arabic: { type: Boolean, default: false },
        chinese: { type: Boolean, default: false },
        russian: { type: Boolean, default: false },
        spam: { type: Boolean, default: false }
    },

    // Name block actions (new) — Off disables, others enforce selected action
    name_blocks_penalty: {
        arabic: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" },
        chinese: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" },
        russian: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" },
        spam: { type: String, enum: ["off", "advise", "warn", "kick", "mute", "ban"], default: "off" }
    },

    // Global behavior toggles
    check_at_join: { type: Boolean, default: false },
    delete_messages: { type: Boolean, default: false }
}, { _id: false });

// for admin_sos settings
const admin_sosSchema = new mongoose.Schema({
    // where to send reports: nobody | founder | staff
    send_to: { type: String, enum: ["nobody", "founder", "staff"], default: "nobody" },

    // tag founder when reporting
    tag_founder: { type: Boolean, default: false },

    // array of admin ids to tag (store as strings for safety)
    tagged_admins: { type: [String], default: [] },

    // normalized staff group identifier: "@username" or "-100<chat_id>"
    // Example: "@MyStaffGroup" or "-1001234567890"
    staff_group: { type: String, default: null },

    // --- Advanced options ---
    // Only accept @admin if used as a reply to another user's message
    only_in_reply: { type: Boolean, default: false },

    // Require a reason (text) when using @admin
    reason_required: { type: Boolean, default: false },

    // If report is marked resolved, delete the report message(s) in the origin chat
    delete_if_resolved: { type: Boolean, default: false },

    // If report resolved, delete the report message in staff group (if sent there)
    delete_in_staff_if_resolved: { type: Boolean, default: false },

    // optional: extensibility container
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

// for blocks settings
const blocksSchema = new mongoose.Schema(
    {
        // ⛔ Blacklist
        // UI: separate Turn On / Turn Off buttons; punishments shown: Off, Ban, Mute
        blacklist: {
            type: new mongoose.Schema(
                {
                    enabled: { type: Boolean, default: false },
                    punishment: { type: String, enum: ["off", "mute", "ban"], default: "ban" },
                    // stores user IDs or @usernames
                    users: { type: [String], default: [] }
                },
                { _id: false }
            ),
            default: () => ({})
        },

        // 🤖 Bot block
        // UI: Off, Warn, Kick, Ban, Mute
        botblock: {
            type: new mongoose.Schema(
                {
                    punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
                    users: { type: [String], default: [] }
                },
                { _id: false }
            ),
            default: () => ({})
        },

        // 🙂 Join block
        // UI: Off, Ban, Mute
        joinblock: {
            type: new mongoose.Schema(
                {
                    enabled: { type: Boolean, default: false },
                    punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
                    users: { type: [String], default: [] }
                },
                { _id: false }
            ),
            default: () => ({})
        },

        // 📕 Leave block
        // UI: Off, Ban
        leaveblock: {
            type: new mongoose.Schema(
                {
                    enabled: { type: Boolean, default: false },
                    punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
                    users: { type: [String], default: [] }
                },
                { _id: false }
            ),
            default: () => ({})
        },

        // 🏃‍♂️ Join-Leave block
        // UI: Delete toggle, Set Time (1–20), Set Join-Leave Limit (1–20), Off/Ban/Mute/Warn
        // Renamed fields for clarity:
        // - jl_time_seconds: the window in seconds within which a quick leave counts
        // - jl_limit: how many quick leaves in that window trigger enforcement
        joinleave: {
            type: new mongoose.Schema(
                {
                    enabled: { type: Boolean, default: false },
                    punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
                    users: { type: [String], default: [] },
                    delete_service_message: { type: Boolean, default: false },
                    jl_time_seconds: { type: Number, default: 3 },
                    jl_limit: { type: Number, default: 2 }
                },
                { _id: false }
            ),
            default: () => ({})
        },

        // 👨‍👩‍👧‍👦 Multiple joins block (anti-raid burst)
        // UI already implemented: threshold (joins), window (seconds)
        multiple_joins: {
            type: new mongoose.Schema(
                {
                    enabled: { type: Boolean, default: false },
                    punishment: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
                    users: { type: [String], default: [] },
                    limit_for_join: { type: Number, default: 4 },
                    multiple_join_seconds: { type: Number, default: 2 } // time window in seconds
                },
                { _id: false }
            ),
            default: () => ({})
        }
    },
    { _id: false }
);

// for media settings
const singleMediaRuleSchema = new mongoose.Schema(
    {
        punishment: {
            type: String,
            enum: ["off", "warn", "kick", "mute", "ban", "delete"],
            default: "off"
        },
        penalty_duration_str: {
            type: String,
            default: "10 minutes"
        },
        delete_messages: {
            type: Boolean,
            default: false
        },
        penalty_duration: {
            type: Number,
            default: 10 * 60 * 1000,                  // 10 minutes in ms
            min: 30 * 1000,                           // minimum 30s
            max: 365 * 24 * 3600 * 1000               // maximum 365 days
        },
        // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
        warned_users: {
            type: [{
                user_id: { type: Number, required: true },
                count: { type: Number, default: 1, min: 1, max: 3 },
            }],
            default: []
        },
        // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
        punished_users: {
            type: [{
                user_id: { type: Number, required: true },
                type: { type: String, enum: ["mute", "ban"], required: true },
                until_ms: { type: Number, required: true }  // Telegram until_date * 1000
            }],
            default: []
        },
    },
    { _id: false }
);
// Main media schema holding all media types
const mediaSchema = new mongoose.Schema(
    {
        story: { type: singleMediaRuleSchema, default: () => ({}) },
        photo: { type: singleMediaRuleSchema, default: () => ({}) },
        video: { type: singleMediaRuleSchema, default: () => ({}) },
        album: { type: singleMediaRuleSchema, default: () => ({}) },
        gif: { type: singleMediaRuleSchema, default: () => ({}) },
        voice: { type: singleMediaRuleSchema, default: () => ({}) },
        audio: { type: singleMediaRuleSchema, default: () => ({}) },
        sticker: { type: singleMediaRuleSchema, default: () => ({}) },
        animated_stickers: { type: singleMediaRuleSchema, default: () => ({}) },
        animated_games: { type: singleMediaRuleSchema, default: () => ({}) },
        animated_emoji: { type: singleMediaRuleSchema, default: () => ({}) },
        premium_emoji: { type: singleMediaRuleSchema, default: () => ({}) },
        file: { type: singleMediaRuleSchema, default: () => ({}) }
    },
    { _id: false }
);

// for porn settings
const pornSchema = new mongoose.Schema(
    {
        enabled: {
            type: Boolean,
            default: false
        },
        penalty: {
            type: String,
            enum: ["off", "warn", "kick", "mute", "ban"],
            default: "off"
        },
        penalty_duration_str: {
            type: String,
            default: "10 minutes"
        },
        penalty_duration: {
            type: Number,
            default: 10 * 60 * 1000,                 // 10 minutes in ms
            min: 30 * 1000,                          // minimum 30 seconds
            max: 365 * 24 * 3600 * 1000              // maximum 365 days
        }, // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
        warned_users: {
            type: [{
                user_id: { type: Number, required: true },
                count: { type: Number, default: 1, min: 1, max: 3 },
            }],
            default: []
        },
        // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
        punished_users: {
            type: [{
                user_id: { type: Number, required: true },
                type: { type: String, enum: ["mute", "ban"], required: true },
                until_ms: { type: Number, required: true }  // Telegram until_date * 1000
            }],
            default: []
        },
        delete_messages: {
            type: Boolean,
            default: false
        }
    },
    { _id: false }
);

// for warns settings
const warnsSchema = new mongoose.Schema(
    {
        // What to do when a member exceeds the warn limit
        penalty: {
            type: String,
            enum: ["off", "kick", "mute", "ban"],
            default: "mute"
        },

        // Optional duration for mute/ban: both human text and ms
        penalty_duration_str: {
            type: String,
            default: "10 minutes"
        },
        penalty_duration: {
            type: Number,
            default: 10 * 60 * 1000,                 // 10 minutes in ms
            min: 30 * 1000,                          // minimum 30 seconds
            max: 365 * 24 * 3600 * 1000              // maximum 365 days
        }, // NEW: Track warn counts (1st warn=1, 2nd=2, 3rd=>kick & reset)
        warned_users: {
            type: [{
                user_id: { type: Number, required: true },
                count: { type: Number, default: 1, min: 1, max: 3 },
            }],
            default: []
        },
        // NEW: Track active mutes/bans (cleanup optional, since Telegram auto-unbans)
        punished_users: {
            type: [{
                user_id: { type: Number, required: true },
                type: { type: String, enum: ["mute", "ban"], required: true },
                until_ms: { type: Number, required: true }  // Telegram until_date * 1000
            }],
            default: []
        },

        // Max warns allowed before applying the penalty
        max_warns: {
            type: Number,
            default: 3,
            min: 1,
            max: 10
        },

        // Users who have reached the warn limit
        warned: {
            type: [
                {
                    _id: false,                          // no _id per warned entry
                    user_id: { type: Number, required: true },
                    username: { type: String, default: "" }, // store without '@'
                    name: { type: String, default: "" }      // display name
                }
            ],
            default: () => []
        }
    },
    { _id: false }
);

// for night mode settings
const nightSchema = new mongoose.Schema(
    {
        // "off" | "delete" (delete medias) | "silence" (global silence)
        mode: {
            type: String,
            enum: ["off", "delete", "silence"],
            default: "off",
            index: true
        },
        // Active window (local hours 0–23, end strictly greater than start in this UI)
        start_hour: {
            type: Number,
            min: 0,
            max: 23,
            default: undefined
        },
        end_hour: {
            type: Number,
            min: 0,
            max: 23,
            default: undefined
        },
        // Show start/end notifications when window toggles
        advise: {
            type: Boolean,
            default: false
        },
    },
    { _id: false }
);

// for time zone settings
const timeZoneSchema = new mongoose.Schema(
    {
        // Human-readable zone:
        // Prefer IANA names like "Asia/Kolkata".
        // If derived from location only, you can store "GMT+05:30".
        tz_name: {
            type: String,
            default: ""
        },
    },
    { _id: false }
);

// for Approval mode settings
const approvalSchema = new mongoose.Schema(
    {
        // Whether the bot handles join requests for this chat
        enabled: {
            type: Boolean,
            default: false,
            index: true
        },
        verify_mode: {
            type: String,
            enum: ["button", "recaptcha", "presentation", "regulation", "math", "quiz"],
            default: null // set to "quiz" on first Turn on if null
        }
    },
    { _id: false }
);

// for delete setting
const timedField = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    time_ms: { type: Number, default: 10 * 60 * 1000 },
    time_str: { type: String, default: "10 minutes" }
}, { _id: false });

const deleteSettingsSchema = new mongoose.Schema({
    edit_checks: {
        enabled: { type: Boolean, default: false },
        time_ms: { type: Number, default: 10 * 60 * 1000 },
        time_str: { type: String, default: "10 minutes" },
        edit_suggestion: { type: Boolean, default: false }
    },

    // EXACT service set requested
    service_messages: {
        join: { type: timedField, default: () => ({ enabled: true, time_ms: 1 * 60 * 1000, time_str: "1 minute" }) }, // Join: after 1 mins
        exit: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) }, // Exit: Off
        new_photo: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) }, // New Photo: Off
        new_title: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) }, // New Title: Off
        pinned: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) }, // Pinned messages: Off
        topics: { type: timedField, default: () => ({ enabled: true, time_ms: 0, time_str: "0 minutes" }) },            // Topics: after 0 mins
        boost: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) }, // Boost: Off
        video_invites: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) },// Video Chats invites: Off
        checklist: { type: timedField, default: () => ({ enabled: false, time_ms: 10 * 60 * 1000, time_str: "10 minutes" }) }, // Checklist: Off
    },

    scheduled: {
        welcome: { type: timedField, default: () => ({}) },
        goodbye: { type: timedField, default: () => ({}) },
        regulation: { type: timedField, default: () => ({}) },
        personal_commands: { type: timedField, default: () => ({}) },
        punishments: { type: timedField, default: () => ({}) },
        bot_service: { type: timedField, default: () => ({}) },
        manual_punishments: { type: timedField, default: () => ({}) }
    },

    self_destruct: {
        enabled: { type: Boolean, default: false },
        time_ms: { type: Number, default: 10 * 60 * 1000 },
        time_str: { type: String, default: "10 minutes" }
    }
}, { _id: false });

// for language settings
const languageSchema = new mongoose.Schema({
    value: {
        type: String,
        enum: [
            "en", "it", "es", "pt", "de", "fr", "ro", "nl",
            "zh_cn", "zh_tw", "uk", "ru", "kk", "tr", "id", "az",
            "uz_latn", "uz_cyrl", "ms", "so", "sq", "sr", "am",
            "el", "ar", "ko", "fa", "ckb", "hi", "si", "bn", "ur"
        ],
        default: "en"
    },
}, { _id: false });

// for banned words settings
const bannedWordsSchema = new mongoose.Schema({
    penalty: { type: String, enum: ["off", "warn", "kick", "mute", "ban"], default: "off" },
    delete_messages: { type: Boolean, default: true },
    username_check: { type: Boolean, default: false },
    name_check: { type: Boolean, default: false },
    bio_check: { type: Boolean, default: false },
    words: { type: [String], default: [] }
}, { _id: false }
);

// for recurring messages settings
const recurringSchema = new mongoose.Schema({
    // Global on/off for the whole recurring module
    enabled: { type: Boolean, default: false },

    // Items array (inline object schema)
    items: [{
        // Per-item enable switch
        enabled: { type: Boolean, default: false },

        // Start time
        start_time: {
            h: { type: Number, min: 0, max: 23, default: 0 },
            m: { type: Number, min: 0, max: 59, default: 0 }
        },

        // Repetition configuration
        repetition: {
            // When per_messages > 0, it takes priority (hours/minutes should be 0)
            hours: { type: Number, min: 0, max: 240, default: 24 },
            minutes: { type: Number, min: 0, max: 59, default: 0 },
            per_messages: { type: Number, min: 0, default: null }
        },

        // Message content
        text: { type: String, default: "" },
        media: {
            // null means "no media set"
            type: { type: String, enum: ["photo", "video", "document", "sticker", null], default: null },
            file_id: { type: String, default: null },
            caption: { type: String, default: "" }
        },

        // Array of rows; each row is an array of {text,url}
        url_buttons: {
            type: [[{
                text: { type: String, trim: true, default: "" },
                url: { type: String, trim: true, default: "" }
            }]],
            default: []
        },

        // Behavior flags
        pin: { type: Boolean, default: false },
        delete_last: { type: Boolean, default: false },
        message_check: { type: Boolean, default: true },

        // Scheduling constraints
        // 0..6 (Sun..Sat)
        days_of_week: { type: [Number], default: [] },
        // 1..31
        days_of_month: { type: [Number], default: [] },

        // Optional hour slot
        slot: {
            from: { type: Number, min: 0, max: 23, default: null },
            to: { type: Number, min: 0, max: 23, default: null }
        },

        // Optional date range
        start_date: { type: Date, default: null },
        end_date: { type: Date, default: null },

        // Telegram topic/thread id (if applicable)
        topic_id: { type: Number, default: null }
    }]
}, { _id: false });

// for message length settings
const msglenInline = {
    enabled: { type: Boolean, default: false },                 // module on/off
    penalty: { type: String, enum: ["off", "warn", "kick"], default: "off" }, // action
    mute: { type: Boolean, default: false },                    // extra flag
    ban: { type: Boolean, default: false },                     // extra flag
    delete_messages: { type: Boolean, default: false },         // delete offending msgs
    // Picker semantics: min=0 => "No limit", max=null => "No limit"
    min: { type: Number, default: 0, min: 0, max: 4000 },
    max: { type: Number, default: null, min: 1, max: 4096 },
    updated_at: { type: Date, default: Date.now }
};

// for masked users settings
const maskedUsersInline = {
    enabled: { type: Boolean, default: false },
    delete_messages: { type: Boolean, default: false },
    whitelist: { type: [String], default: [] }
};

// for personal commands settings
const personalCommandsInline = {
    // Array of objects:
    // { name, aliases[], text, media? }
    commands: { type: Array, default: [] }
};

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
        media: mediaSchema,
        porn: pornSchema,
        warns: warnsSchema,
        night: nightSchema,
        time_zone: timeZoneSchema,
        approval: approvalSchema,
        delete_settings: deleteSettingsSchema,
        lang: languageSchema,
        word_filter: bannedWordsSchema,
        recurring: recurringSchema,
        msglen: msglenInline,
        masked_users: maskedUsersInline,
        personal_commands: personalCommandsInline,
    },
    { _id: false }
);

const telegramLoginSchema = new mongoose.Schema({
    phone: { type: String, default: null },
    phone_code_hash: { type: String, default: null },      // auth.sendCode ka phone_code_hash [web:398]
    pending_session_string: { type: String, default: null },// StringSession save() after sendCode/signIn attempt
    stage: { type: String, enum: ["OTP_SENT", "TWO_FA"], default: null },
    created_at: { type: Date, default: null },
    otp_verified_at: { type: Date, default: null },
    expires_at: { type: Date, default: null }              // auto-expire control
}, { _id: false });


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

        user_session_string: { type: String, default: "" },
        telegram_login: telegramLoginSchema
    },
    { timestamps: true, versionKey: false }
);

let user_setting_module;
if (group_help_advance_connection) {
    user_setting_module = group_help_advance_connection.model(
        "user_settings",
        userSchema
    )
}

module.exports = user_setting_module;