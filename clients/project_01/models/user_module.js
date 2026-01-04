// user_model.js
const mongoose = require("mongoose");
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");

const telegramUserSchema = new mongoose.Schema(
    {
        // Telegram identity
        user_id: { type: Number, required: true, unique: true, index: true },
        first_name: { type: String, required: true, trim: true },
        last_name: { type: String, default: "", trim: true },
        username: { type: String, default: "", trim: true, index: true },
        allows_write_to_pm: { type: Boolean, default: false },

        // Invite
        invite_code: { type: String, unique: true, sparse: true, index: true }, // generate separately
        joined_via_invite_code: { type: String, default: null, index: true },

        // Registration / activation status (keep it simple & audit-friendly)
        registration_status: {
            type: String,
            enum: ["PENDING", "ACTIVE", "BLOCKED"],
            default: "PENDING",
            index: true,
        },

        // Dashboard cached totals (actual transactions should be in separate collections)
        wallet_balance: { type: Number, default: 0, min: 0 },
        total_earned: { type: Number, default: 0, min: 0 },
        total_withdrawn: { type: Number, default: 0, min: 0 },

        // Timestamps
        created_at: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

// Helpful indexes
telegramUserSchema.index({ invited_by_userDB_id: 1, created_at: -1 });
telegramUserSchema.index({ referral_code: 1 }, { unique: true, sparse: true });

let user_module;
if (project_01_connection) {
    user_module = project_01_connection.model("Telegram_user", telegramUserSchema);
}

module.exports = user_module;