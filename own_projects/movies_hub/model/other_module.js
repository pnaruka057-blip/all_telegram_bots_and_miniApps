const mongooose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection')

const otherSchema = new mongooose.Schema({
    document_name: { type: String, required: true },
    plan_price: { type: Number },
    plan_duration: { type: Number },
    plan_prev_price: { type: Number },
});

const other_modules = Movies_hub_connection.model('other_modules', otherSchema);

module.exports = other_modules;