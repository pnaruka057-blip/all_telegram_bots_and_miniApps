const mongoose = require("mongoose");
const { group_help_advance_connection } = require("../../../globle_helper/mongoDB_connection");

const autoDeleteMessageSchema = new mongoose.Schema({

    // Reference to your user_settings document (_id)
    userDB_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user_settings",
        required: true,
        index: true
    },

    // Telegram group / supergroup id
    group_id: {
        type: Number,
        required: true,
        index: true
    },

    // Telegram message id returned by ctx.reply / replyWithPhoto etc.
    message_id: {
        type: Number,
        required: true
    },

    // When message was sent
    sent_at: {
        type: Date,
        default: Date.now
    },

    // When to delete
    delete_at: {
        type: Date,
        required: true,
        index: true
    },

    // TTL stored for reference (minutes)
    ttl_minutes: {
        type: Number,
        required: true
    },

    // message origin / module
    type: {
        type: String,
        enum: [
            "welcome",
            "goodbye",
            "regulation",
            "recurring",
            "punishment",
            "manual_punishment",
            "personal_command",
            "service_message",
            "bot_service_message",
            "custom",
        ],
        default: "custom",
        index: true
    },

    // lifecycle state
    status: {
        type: String,
        enum: ["pending", "failed"],
        default: "pending",
        index: true
    },
}, { versionKey: false });

autoDeleteMessageSchema.index({ group_id: 1, message_id: 1 }, { unique: true });

let auto_delete_messages_module;
if (group_help_advance_connection) {
    auto_delete_messages_module = group_help_advance_connection.model(
        "auto_delete_messages",
        autoDeleteMessageSchema
    );
}

module.exports = auto_delete_messages_module;