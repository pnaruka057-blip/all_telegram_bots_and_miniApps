const mongoose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection')

const showSchema = new mongoose.Schema({
    title: { type: String, required: true },
    release_date: { type: String, required: true },
    language: { type: String, required: true },
    genre: { type: String, required: true },
    series: {
        type: [
            {
                download_link: { type: [String], required: true },
                quality: { type: [String], required: true },
            }
        ], required: true
    },
    download_count: { type: Number, default: 0 },
    thumbnail: { type: String, required: true },
    category: { type: String, required: true },
}, { timestamps: true });

const shows_module = Movies_hub_connection.model('shows_modules', showSchema);

module.exports = shows_module;