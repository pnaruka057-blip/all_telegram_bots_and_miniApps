// user_model.js
const mongoose = require("mongoose");
const { project_02_connection } = require("../../globle_helper/mongoDB_connection");

const userSchema = new mongoose.Schema(
    {
        telegramId: { type: Number, required: true, unique: true, index: true },
        username: { type: String },
        firstName: { type: String },
        lastName: { type: String },
        createdAt: { type: Date, required: true, default: Date.now },
    },
    {
        versionKey: false, // __v off (storage optimize)
    }
);

let user_module;
if (project_02_connection) {
    user_module = project_02_connection.model("users", userSchema);
}

module.exports = user_module;