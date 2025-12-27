const mongooose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection')

const userSchema = new mongooose.Schema({
    user_id: { type: Number, required: true, unique: true },
    first_name: String,
    username: String,
    language_code: { type: String },
    is_started: { type: Boolean, default: true },
    is_blocked: { type: Boolean, default: false },
    profile_logo: { type: String, default: "https://res.cloudinary.com/dm8miilli/image/upload/v1755791642/profile_hbb9k4.png" },
    last_seen: { type: Date, default: Date.now }
});

let users_module;
if (Movies_hub_connection) {
    users_module = Movies_hub_connection.model('users_modules', userSchema)
}

module.exports = users_module;
