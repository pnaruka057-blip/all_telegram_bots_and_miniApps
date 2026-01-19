const mongoose = require("mongoose");
const LOG = require('./logger')

let promoX_connection;
// promoX
if (process.env.PROMOX_NODE_ENV && process.env.PROMOX_NODE_ENV !== 'development') {
  promoX_connection = mongoose.createConnection(process.env.MONGO_URL_PROMOX, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  promoX_connection.on("connected", () => {
    console.log(`📦 PromoX Connected to MongoDB: ${process.env.MONGO_URL_PROMOX}`);
    LOG(`📦 PromoX Connected to MongoDB: ${process.env.MONGO_URL_PROMOX}`);
  });
  promoX_connection.on("error", (err) => {
    console.error(`❌ PromoX MongoDB connection error: ${err}`);
    LOG(`❌ PromoX MongoDB connection error: ${err}`);
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
    LOG(`📦 moviesHub Connected to MongoDB: ${process.env.MONGO_URL_MOVIEHUB}`);
  });
  Movies_hub_connection.on("error", (err) => {
    console.error(`❌ moviesHub MongoDB connection error: ${err}`);
    LOG(`❌ moviesHub MongoDB connection error: ${err}`);
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
    LOG(`📦 Group Help Advance Connected to MongoDB: ${process.env.MONGO_URL_GROUP_HELP_ADVANCE}`);
  });
  group_help_advance_connection.on("error", (err) => {
    console.error(`❌ Group Help Advance MongoDB connection error: ${err}`);
    LOG(`❌ Group Help Advance MongoDB connection error: ${err}`);
  });
}

let project_01_connection;
// Project 01
if (process.env.PROJECT_01_NODE_ENV && process.env.PROJECT_01_NODE_ENV !== 'development') {
  project_01_connection = mongoose.createConnection(process.env.MONGO_URL_PROJECT_01, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  project_01_connection.on("connected", () => {
    console.log(`📦 Project 01 Connected to MongoDB: ${process.env.MONGO_URL_PROJECT_01}`);
    LOG(`📦 Project 01 Connected to MongoDB: ${process.env.MONGO_URL_PROJECT_01}`);
  });
  project_01_connection.on("error", (err) => {
    console.error(`❌ Project 01 MongoDB connection error: ${err}`);
    LOG(`❌ Project 01 MongoDB connection error: ${err}`);
  });
}

let project_02_connection;
// Project 01
if (process.env.PROJECT_02_NODE_ENV && process.env.PROJECT_02_NODE_ENV !== 'development') {
  project_02_connection = mongoose.createConnection(process.env.MONGO_URL_PROJECT_02, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  project_02_connection.on("connected", () => {
    console.log(`📦 Project 02 Connected to MongoDB: ${process.env.MONGO_URL_PROJECT_02}`);
    LOG(`📦 Project 02 Connected to MongoDB: ${process.env.MONGO_URL_PROJECT_02}`);
  });
  project_02_connection.on("error", (err) => {
    console.error(`❌ Project 02 MongoDB connection error: ${err}`);
    LOG(`❌ Project 02 MongoDB connection error: ${err}`);
  });
}

let TechBoost_it_services_connection;
// TechBoost IT Services Recipts
if (process.env.TECHBOOST_IT_SERVICES_NODE_ENV && process.env.TECHBOOST_IT_SERVICES_NODE_ENV !== 'development') {
  TechBoost_it_services_connection = mongoose.createConnection(process.env.MONGO_URL_TECHBOOST_IT_SERVICES, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  TechBoost_it_services_connection.on("connected", () => {
    console.log(`📦 TechBoost IT Services Connected to MongoDB: ${process.env.MONGO_URL_TECHBOOST_IT_SERVICES}`);
    LOG(`📦 TechBoost IT Services Connected to MongoDB: ${process.env.MONGO_URL_TECHBOOST_IT_SERVICES}`);
  });
  TechBoost_it_services_connection.on("error", (err) => {
    console.error(`❌ TechBoost IT Services MongoDB connection error: ${err}`);
    LOG(`❌ TechBoost IT Services MongoDB connection error: ${err}`);
  });
}

module.exports = { promoX_connection, Movies_hub_connection, group_help_advance_connection, project_01_connection, project_02_connection, TechBoost_it_services_connection }