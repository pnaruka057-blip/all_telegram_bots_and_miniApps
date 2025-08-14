require('dotenv').config()
let promoX_token = process.env.PROMOX_TOKEN
const express = require('express')
const app = express()
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const path = require('path')
const cors = require('cors');
const cookieParser = require('cookie-parser');
const Redis = require('ioredis')
const promoX_routes = require('./clients/PromoX/routes/all_routes')
const promoX_all_actions = require('./clients/PromoX/bot_handler/promoX_bot')
const message_auto_save_and_post = require('./clients/mr_akash/Message_auto_save_and_post/message_auto_save_and_post')
const crypto_news_all_actions = require('./clients/mr_akash/Crypto_news/crypto_news_bot')


// all set
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'public'));


// clients bot instances
// Initialize and launch PromoX bot only if PROMOX_NODE_ENV is not 'development'
if (process.env.PROMOX_NODE_ENV && process.env.PROMOX_NODE_ENV !== 'development') {
    const promoX_bot = new Telegraf(process.env.BOT_TOKEN_PROMOX);
    promoX_all_actions(promoX_bot, promoX_token);
    promoX_bot.launch()
        .then(() => console.log("🤖 PromoX Bot started"))
        .catch(console.error);
}

// Initialize and launch Crypto News bot only if CRYPTO_NEWS_NODE_ENV is not 'development'
if (process.env.CRYPTO_NEWS_NODE_ENV && process.env.CRYPTO_NEWS_NODE_ENV !== 'development') {
    const crypto_news_bot = new Telegraf(process.env.BOT_TOKEN_CRYPTO_NEWS);
    crypto_news_all_actions(crypto_news_bot);
    crypto_news_bot.launch()
        .then(() => console.log("🤖 Crypto News Bot started"))
        .catch(console.error);
}

// Initialize and launch Message Auto Save and Post bot only if MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV is not 'development'
if (process.env.MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV && process.env.MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV !== 'development') {
    const message_auto_save_and_post_bot = new Telegraf(process.env.BOT_TOKEN_MESSAGE_AUTO_SAVE_AND_POST);
    message_auto_save_and_post(message_auto_save_and_post_bot);

    // Webhook binding
    app.use(message_auto_save_and_post_bot.webhookCallback('/telegram-webhook'));
    message_auto_save_and_post_bot.telegram.setWebhook(
        `${process.env.GLOBLE_DOMAIN}/telegram-webhook`
    );
}

app.get('/', (req, res) => {
    res.send('✅ Bot is alive!');
});


// all middleware
app.use(cors())
app.use(express.json());
app.use(cookieParser());
app.use('/:token', (req, res, next) => {
    const tokenName = req.params.token;

    message_auto_save_and_post_bot.command('save', async (ctx) => { await ctx.reply('✅ Your message has been saved!') });

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

// Express app to keep server alive
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// Global Error Handlers (So one bot’s error doesn't crash others)
process.on('uncaughtException', (err) => {
    console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠ Unhandled Rejection:', reason);
});