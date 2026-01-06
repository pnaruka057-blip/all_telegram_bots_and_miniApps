// invite_model.js
const mongoose = require("mongoose");
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");

const inviteSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, index: true },
        invited_by_userDB_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Telegram_user",
            default: null
        },
        invite_to_userDB_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Telegram_user",
            default: null
        },
        earned_commission: { type: Number, default: 0, min: 0 },
        created_at: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

inviteSchema.index({ owner_user_id: 1, created_at: -1 });
inviteSchema.index({ status: 1, expires_at: 1 });

let invite_model;
if (project_01_connection) {
    invite_model = project_01_connection.model("Invite", inviteSchema);
}

module.exports = invite_model;