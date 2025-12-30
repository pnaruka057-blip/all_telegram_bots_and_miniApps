const express = require('express')
const app = express()
const upload = require('../../../globle_helper/multer_file_upload_mongoDB')
const checkTelegramUsername = require('../helpers/checkTelegramUsername')
const path = require('path')
const user_setting_module = require('../models/user_settings_module');
const expressEjsLayouts = require('express-ejs-layouts');
let group_help_advance_token = process.env.GROUP_HELP_ADVANCE_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME

app.use(express.static(path.join(__dirname, '..', "public")))
app.use(expressEjsLayouts);

app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, '..', 'public', 'views'));
app.set('layout', path.resolve(__dirname, '..', 'public', 'views', 'layout'));

app.get('/group-help-advance/html_message_design', (req, res) => {
    const { placeholders } = req.query;
    res.render('pages/html_message_design', {
        developer_telegram_username,
        placeholders: placeholders === 'true' ? true : false
    })
})

app.get('/group-help-advance/buttons-design', (req, res) => {
    res.render('pages/btn_design', {
        developer_telegram_username,
    })
})

app.get("/group-help-advance/privacy-policy", (req, res) => {
    res.render("pages/privacy_policy", {
        developer_telegram_username,
        botName: "Group Help Advance Bot",
        botHandle: "@Group_help_advanced_bot",
        brandName: "Group Help Advance",
        supportTelegram_account: "support@yourdomain.com",
        ownerName: "Earning Planer IT Services",
        ownerAddress: "Jaipur, Rajasthan, IN",
        lastUpdated: "December 29, 2025",
        botLogoUrl: "https://yourdomain.com/path-to-bot-logo.png"
    });
});

module.exports = app