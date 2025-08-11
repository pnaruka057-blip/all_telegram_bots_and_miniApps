const mongoose = require('mongoose');

// Connect to MongoDB
module.exports = (mongoDB_url) => {
    mongoose.connect(mongoDB_url, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    }).then(() => {
        console.log('📦 Connected to MongoDB');
    }).catch((err) => {
        console.error('❌ MongoDB connection error:', err);
    });
};
