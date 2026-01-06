// user_model.js
const mongoose = require("mongoose");
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");

const transactionSchema = new mongoose.Schema(
    {
        userDB_id: { type: mongoose.Schema.Types.ObjectId, required: true },
        type: { type: String, enum: ["W", "I", "B"] }, // W = withdrawal, I = invite commission, B = Daily Bonus
        amount: { type: Number, default: 0 },
        created_at: { type: Date, default: Date.now },
        status: { type: String, enum: ["P", "S", "R"], default: "P" }, // P = Pending, S = Success, R = Rejected
        note: { type: String, required: true }
    },
    { versionKey: false }
);

let transaction_model;
if (project_01_connection) {
    transaction_model = project_01_connection.model("transaction", transactionSchema);
}

module.exports = transaction_model;