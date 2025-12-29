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
        currentPath: '/',
        developer_telegram_username,
        current_url: process.env.GLOBLE_DOMAIN,
        token: group_help_advance_token,
        placeholders: placeholders === 'true' ? true : false
    })
})

app.get('/group-help-advance/buttons-design', (req, res) => {
    res.render('pages/btn_design', {
        currentPath: '/',
        developer_telegram_username,
        current_url: process.env.GLOBLE_DOMAIN,
        token: group_help_advance_token
    })
})

app.get('/group-help-advance/privacy-policy', (req, res) => {
    res.render('pages/privacy_policy', {
        currentPath: '/',
        developer_telegram_username,
        current_url: process.env.GLOBLE_DOMAIN,
        token: group_help_advance_token
    })
})

module.exports = app