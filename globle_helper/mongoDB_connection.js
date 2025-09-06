const mongoose = require("mongoose");

// promoX
const promoX_connection = mongoose.createConnection(process.env.MONGO_URL_PROMOX, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
promoX_connection.on("connected", () => {
  console.log(`📦 PromoX Connected to MongoDB: ${process.env.MONGO_URL_PROMOX}`);
});
promoX_connection.on("error", (err) => {
  console.error(`❌ PromoX MongoDB connection error: ${err}`);
});

// moviesHub
const Movies_hub_connection = mongoose.createConnection(process.env.MONGO_URL_MOVIEHUB, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
Movies_hub_connection.on("connected", () => {
  console.log(`📦 moviesHub Connected to MongoDB: ${process.env.MONGO_URL_MOVIEHUB}`);
});
Movies_hub_connection.on("error", (err) => {
  console.error(`❌ moviesHub MongoDB connection error: ${err}`);
});

// Group Help Advance
const group_help_advance_connection = mongoose.createConnection(process.env.MONGO_URL_GROUP_HELP_ADVANCE, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
group_help_advance_connection.on("connected", () => {
  console.log(`📦 Group Help Advance Connected to MongoDB: ${process.env.MONGO_URL_GROUP_HELP_ADVANCE}`);
});
group_help_advance_connection.on("error", (err) => {
  console.error(`❌ Group Help Advance MongoDB connection error: ${err}`);
});

module.exports = { promoX_connection, Movies_hub_connection, group_help_advance_connection }