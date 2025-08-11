// models/group.js
const mongoose = require("mongoose");

const channelSchema = new mongoose.Schema({
    userDB_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Telegram_user",
        required: true
    },
    channel_name: {
        type: String,
        required: true,
        trim: true
    },
    username: {
        type: String,
        trim: true
    },
    category: {
        type: String,
        required: true,
        trim: true
    },
    short_description: {
        type: String,
        maxlength: 300,
        trim: true
    },
    logo: {
        data: Buffer,           // Binary format
        contentType: String     // MIME type (e.g., "image/png", "image/jpeg")
    },
    auto_delete_time: {
        type: Date,              // कब delete होना है
        required: true
    },
    created_at: {
        type: Date,
        default: Date.now
    }
});

// TTL index on auto_delete_time
channelSchema.index({ auto_delete_time: 1 }, { expireAfterSeconds: 0 });

const user_channels = mongoose.model("user_channels", channelSchema);

module.exports = user_channels