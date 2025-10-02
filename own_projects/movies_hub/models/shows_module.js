const mongoose = require('mongoose');
const { Movies_hub_connection } = require('../../../globle_helper/mongoDB_connection');

const seasonSchema = new mongoose.Schema({
    release_date: { type: String, required: true }, // e.g., "01 Jan 2025"
    language: { type: String, required: true }, // e.g., "Hindi"
    download_link: { type: [String], required: true },
    quality: { type: [String], required: true }
}, { _id: false }); // optional: seasons won't get their own _id (remove _id:false if you want each season to have an _id)

const showSchema = new mongoose.Schema({
    title: { type: String, required: true },
    genre: { type: String, required: true },
    thumbnail: { type: String, required: true },
    category: {
        type: String,
        required: true,
    },
    series: {
        type: [seasonSchema],
        required: true,
        validate: {
            validator: function (seasons) {
                // Ensure each season has equal number of download links and qualities
                if (!Array.isArray(seasons) || seasons.length === 0) return false;
                return seasons.every(s =>
                    Array.isArray(s.download_link) &&
                    Array.isArray(s.quality) &&
                    s.download_link.length === s.quality.length &&
                    s.download_link.length > 0
                );
            },
            message: 'Each season must have download_link and quality arrays of the same non-zero length.'
        }
    },
    download_count: { type: Number, default: 0 }
}, { timestamps: true });

let shows_module;
if(Movies_hub_connection){
    shows_module = Movies_hub_connection.model('shows_modules', showSchema)
}

module.exports = shows_module;