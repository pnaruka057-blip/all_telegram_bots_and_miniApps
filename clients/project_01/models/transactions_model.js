// user_model.js
const mongoose = require("mongoose");
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");

const transactionSchema = new mongoose.Schema(
    {
        userDB_id: { type: mongoose.Schema.Types.ObjectId, required: true },
        type: { type: String, enum: ["W", "D", "I", "B"] }, // W = withdrawal, I = invite commission, B = Daily Bonus, D = Deposit
        amount: { type: Number, default: 0 },
        created_at: { type: Date, default: Date.now },
        status: { type: String, enum: ["P", "S", "R"], default: "P" }, // P = Pending, S = Success, R = Rejected
        note: { type: String, required: true },

        // --- WatchPay mapping (optional for other txns) ---
        gateway: { type: String, default: "" }, // "WATCHPAY"
        mch_order_no: { type: String, default: "", index: true }, // our order id sent to gateway
        gateway_order_no: { type: String, default: "" }, // gateway orderNo (if received)
        trade_result: { type: String, default: "" }, // "1" success etc
        raw_callback: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { versionKey: false }
);

let transaction_model;
if (project_01_connection) {
    transaction_model = project_01_connection.model("transaction", transactionSchema);
}

module.exports = transaction_model;