// models/group.js
const mongoose = require("mongoose");
const { promoX_connection } = require('../../../globle_helper/mongoDB_connection')

const groupSchema = new mongoose.Schema({
    userDB_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Telegram_user",
        required: true
    },
    group_name: {
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
groupSchema.index({ auto_delete_time: 1 }, { expireAfterSeconds: 0 });

let user_groups;

if (promoX_connection) {
    user_groups = promoX_connection.model("user_groups", groupSchema)
}

module.exports = user_groups