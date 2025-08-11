require('dotenv').config()
let promoX_token = process.env.PROMOX_TOKEN
const express = require('express')
const app = express()
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const path = require('path')
const cors = require('cors');
const cookieParser = require('cookie-parser');
const promoX_routes = require('./clients/PromoX/routes/all_routes')
const promoX_all_actions = require('./clients/PromoX/bot_handler/promoX_bot')


// all middleware
app.use(cors())
app.use(express.json());
app.use(cookieParser());
app.use('/:token', (req, res, next) => {
    const tokenName = req.params.token;

    let token_array = [
        promoX_token
    ]

    if (!token_array.includes(tokenName)) {
        res.render('404', { error_message: 'You are not allowed' });
    } else {
        next();
    }
});
app.use(`/${promoX_token}`, promoX_routes)


// all set
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'public'));


// clients bot instances
const promoX_bot = new Telegraf(process.env.BOT_TOKEN_PROMOX);
promoX_all_actions(promoX_bot, promoX_token)


// Start the bot
promoX_bot.launch()
    .then(() => console.log("🤖 PromoX Bot started"))
    .catch(console.error);

    
// Express app to keep server alive
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});