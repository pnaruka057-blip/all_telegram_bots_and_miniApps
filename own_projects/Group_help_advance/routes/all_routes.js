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

app.get('/group-help-advance', (req, res) => {
    res.render('pages/home', {
        developer_telegram_username,
        token: group_help_advance_token
    })
})

app.get('/group-help-advance/html_message_design', (req, res) => {
    const { placeholders } = req.query;
    res.render('pages/html_message_design', {
        developer_telegram_username,
        placeholders: placeholders === 'true' ? true : false,
        token: group_help_advance_token
    })
})

app.get('/group-help-advance/buttons-design', (req, res) => {
    res.render('pages/btn_design', {
        developer_telegram_username,
        token: group_help_advance_token
    })
})

app.get("/group-help-advance/privacy-policy", (req, res) => {
    res.render("pages/privacy_policy", {
        developer_telegram_username,
        botName: "Group Help Advance Bot",
        botHandle: "@Group_help_advanced_bot",
        brandName: "Group Help Advance",
        supportTelegram_account: "https://telegram.me/Earning_planer",
        ownerName: "Earning Planer IT Services",
        ownerAddress: "Jaipur, Rajasthan, IN",
        lastUpdated: "December 29, 2025",
        token: group_help_advance_token,
        botLogoUrl: "https://cdn5.telesco.pe/file/pLZhHNHpRsAxX-WAOAzr76AW20kOG7P2MPrn_f46wC7FHQL-D6e0JJdHwsGMKRphbDODw6lKLDU1G94SnWXIr580oIX-2IsjnZFR5csIXOfbmPS45FlOfGebLD19sVVzOW380GGl_vZ2ds4v7O7ngN02Wy_iA7Sv30apKJP9V7dGcfV8VPwBlHV9HDYWrGZcKOL8yyv1ByMRVryyQZOTkXOvWw3pOrZcC6ycBk3k37w130GPXBbF2P8lTl9FcxKUZiTMOm1s_AZ_AB4XpBw-VnE0gNY-g4gcC2V6fRWXJEj4Oi0Y-LQkVArlRprCUHaCOmH41et6UqEIcKpJ7DPmOw.jpg"
    });
});

module.exports = app