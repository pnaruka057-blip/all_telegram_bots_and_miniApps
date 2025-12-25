// const mongoose = require('mongoose');
// const { TechBoost_it_services_connection } = require('../../../globle_helper/mongoDB_connection');

// /* ----------------------------------
//    Counter schema (SAME connection)
// ---------------------------------- */
// const counterSchema = new mongoose.Schema(
//     {
//         _id: { type: String, required: true },
//         seq: { type: Number, default: 0 }
//     },
//     { bufferCommands: false }
// );

// // IMPORTANT: use SAME connection
// const Counter = TechBoost_it_services_connection.model(
//     "Counter",
//     counterSchema
// );

// /* ----------------------------------
//    Receipt schema
// ---------------------------------- */
// const receiptSchema = new mongoose.Schema(
//     {
//         receiptNumber: { type: String, unique: true, index: true },
//         clientName: { type: String, required: true },
//         clientAddress: { type: String, default: "" },
//         serviceDescription: { type: String, default: "" },
//         amount: { type: Number, default: 0 },
//         paymentMode: { type: String, default: "" },
//         paymentScreenshotFileId: { type: String, default: "" }, // Telegram file_id
//         createdAt: { type: Date, default: Date.now }
//     },
//     { bufferCommands: false }
// );

// /* ----------------------------------
//    Auto receipt number generator
// ---------------------------------- */
// receiptSchema.pre("validate", async function (next) {
//     try {
//         if (this.receiptNumber) return next();

//         const year = new Date().getFullYear();
//         const counterId = `receipt_${year}`;

//         const counter = await Counter.findOneAndUpdate(
//             { _id: counterId },
//             { $inc: { seq: 1 } },
//             { upsert: true, new: true, setDefaultsOnInsert: true }
//         ).exec();

//         const seq = counter?.seq || 1;
//         this.receiptNumber = `TB-${year}-${String(seq).padStart(4, "0")}`;

//         next();
//     } catch (err) {
//         next(err);
//     }
// });

// /* ----------------------------------
//    Receipt model (SAME connection)
// ---------------------------------- */
// const receipts_model = TechBoost_it_services_connection.model(
//     'Receipt',
//     receiptSchema
// );

// module.exports = receipts_model;
