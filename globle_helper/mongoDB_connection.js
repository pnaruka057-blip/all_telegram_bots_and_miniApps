const mongoose = require("mongoose");

let promoX_connection;
// promoX
if (process.env.PROMOX_NODE_ENV && process.env.PROMOX_NODE_ENV !== 'development') {
  promoX_connection = mongoose.createConnection(process.env.MONGO_URL_PROMOX, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  promoX_connection.on("connected", () => {
    console.log(`📦 PromoX Connected to MongoDB: ${process.env.MONGO_URL_PROMOX}`);
  });
  promoX_connection.on("error", (err) => {
    console.error(`❌ PromoX MongoDB connection error: ${err}`);
  });
}

let Movies_hub_connection;
// moviesHub
if (process.env.MOVIES_HUB_NODE_ENV && process.env.MOVIES_HUB_NODE_ENV !== 'development') {
  Movies_hub_connection = mongoose.createConnection(process.env.MONGO_URL_MOVIEHUB, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  Movies_hub_connection.on("connected", () => {
    console.log(`📦 moviesHub Connected to MongoDB: ${process.env.MONGO_URL_MOVIEHUB}`);
  });
  Movies_hub_connection.on("error", (err) => {
    console.error(`❌ moviesHub MongoDB connection error: ${err}`);
  });
}

let group_help_advance_connection;
// Group Help Advance
if (process.env.GROUP_HELP_ADVANCE_NODE_ENV && process.env.GROUP_HELP_ADVANCE_NODE_ENV !== 'development') {
  group_help_advance_connection = mongoose.createConnection(process.env.MONGO_URL_GROUP_HELP_ADVANCE, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  group_help_advance_connection.on("connected", () => {
    console.log(`📦 Group Help Advance Connected to MongoDB: ${process.env.MONGO_URL_GROUP_HELP_ADVANCE}`);
  });
  group_help_advance_connection.on("error", (err) => {
    console.error(`❌ Group Help Advance MongoDB connection error: ${err}`);
  });
}

let checker_gai_dep_connection;
// Checker Gái Đẹp
if (process.env.CHECKER_GAI_DEP_NODE_ENV && process.env.CHECKER_GAI_DEP_NODE_ENV !== 'development') {
  checker_gai_dep_connection = mongoose.createConnection(process.env.MONGO_URL_CHECKER_GAI_DEP, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  checker_gai_dep_connection.on("connected", () => {
    console.log(`📦 Checker Gái Đẹp Connected to MongoDB: ${process.env.MONGO_URL_CHECKER_GAI_DEP}`);
  });
  checker_gai_dep_connection.on("error", (err) => {
    console.error(`❌ Checker Gái Đẹp MongoDB connection error: ${err}`);
  });
}

module.exports = { promoX_connection, Movies_hub_connection, group_help_advance_connection, checker_gai_dep_connection }