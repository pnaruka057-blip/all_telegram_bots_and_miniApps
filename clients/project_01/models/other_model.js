// other_model.js
const mongoose = require("mongoose");
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");

const otherSchema = new mongoose.Schema(
    {
        document_name: { type: String, required: true },

        // document_name: commission_rates
        level_1_rate: { type: Number, required: true },
        level_2_rate: { type: Number, required: true },
        level_3_rate: { type: Number, required: true },
        level_4_rate: { type: Number, required: true },
        level_5_rate: { type: Number, required: true },
        level_6_rate: { type: Number, required: true },
        level_7_rate: { type: Number, required: true },
    },
    { versionKey: false }
);

let other_model;
if (project_01_connection) {
    other_model = project_01_connection.model("other", otherSchema);
}

module.exports = other_model;