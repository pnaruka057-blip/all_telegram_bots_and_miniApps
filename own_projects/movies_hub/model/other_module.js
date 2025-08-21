const mongooose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection');

const otherSchema = new mongooose.Schema({
    document_name: { type: String, required: true },

    // handle primum users
    plan_price: { type: Number },
    plan_duration: { type: Number },
    plan_prev_price: { type: Number },

    // handle requestes
    title: { type: String },
    language: { type: String },
    type: { type: String, enum: ['movie', 'show'] },
    status: { type: Boolean, default: false },
    requested_by: { type: mongooose.Schema.Types.ObjectId },
}, { timestamps: true });

const other_modules = Movies_hub_connection.model('other_modules', otherSchema);

module.exports = other_modules;