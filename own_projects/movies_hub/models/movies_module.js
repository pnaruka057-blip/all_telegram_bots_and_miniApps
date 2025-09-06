const mongoose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection')

const movieSchema = new mongoose.Schema({
    title: { type: String, required: true },
    release_date: { type: String, required: true },
    language: { type: String, required: true },
    genre: { type: String, required: true },
    download_link: { type: [String], required: true },
    download_count: { type: Number, default: 0 },
    thumbnail: { type: String, required: true },
    quality: { type: [String], required: true },
    category: { type: String, required: true },
}, { timestamps: true });

const movies_module = Movies_hub_connection.model('movies_modules', movieSchema);

module.exports = movies_module;
