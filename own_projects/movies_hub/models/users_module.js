const mongooose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection')

const userSchema = new mongooose.Schema({
    user_id: { type: Number, required: true },
    user_logo: { type: String, required: true },
    name: { type: String, required: true },
    username: { type: String, required: true },
    language: { type: String },
    isPremium: { type: Boolean, default: false },
    premium_start_date: { type: Date },
    premium_end_date: { type: Date },
    joinedAt: { type: Date, default: Date.now },
    groupsLists: {
        type: [{
            groupId: { type: String, required: true },
            groupName: { type: String, required: true },
            isAdmin: { type: Boolean, default: false },
        }],
    },
    link_shortner_config: {
        type: {
            link_shortner_quick_link: { type: String, required: true },
            link_shortner_api_link: { type: String, required: true },
        }
    }
});

let users_module;
if(Movies_hub_connection){
    users_module = Movies_hub_connection.model('users_modules', userSchema)
} 

module.exports = users_module;
