require('dotenv').config()
let promoX_token = process.env.PROMOX_TOKEN
let movies_hub_token = process.env.MOVIES_HUB_TOKEN
const express = require('express')
const app = express()
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const path = require('path')
const cors = require('cors');
const cookieParser = require('cookie-parser');
const promoX_routes = require('./clients/PromoX/routes/all_routes')
const movies_hub_routes = require('./own_projects/movies_hub/routes/all_routes')
const promoX_all_actions = require('./clients/PromoX/bot_handler/promoX_bot')
const message_auto_save_and_post = require('./clients/mr_akash/Message_auto_save_and_post_and_delete/Message_auto_save_and_post_and_delete')
const crypto_news_all_actions = require('./clients/mr_akash/Crypto_news/crypto_news_bot')
const movies_hub_all_actions = require('./own_projects/movies_hub/bot_index')
const group_help_advance_all_actions = require('./own_projects/Group_help_advance/bot_index')
const globle_domain = process.env.GLOBLE_DOMAIN

// all system middleware
app.use(cors())
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// all set
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'public'));


// Initialize and launch PromoX bot only if PROMOX_NODE_ENV is not 'development'
if (process.env.PROMOX_NODE_ENV && process.env.PROMOX_NODE_ENV !== 'development') {
    const promoX_bot = new Telegraf(process.env.BOT_TOKEN_PROMOX);
    promoX_all_actions(promoX_bot, promoX_token);

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-promox', promoX_bot.webhookCallback('/telegram-webhook-for-promox'));
    promoX_bot.telegram.setWebhook(
        `${process.env.GLOBLE_DOMAIN}/telegram-webhook-for-promox`
    );
}

// Initialize and launch Crypto News bot only if CRYPTO_NEWS_NODE_ENV is not 'development'
if (process.env.CRYPTO_NEWS_NODE_ENV && process.env.CRYPTO_NEWS_NODE_ENV !== 'development') {
    const crypto_news_bot = new Telegraf(process.env.BOT_TOKEN_CRYPTO_NEWS);
    crypto_news_all_actions(crypto_news_bot);

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-crypto-news', crypto_news_bot.webhookCallback('/telegram-webhook-for-crypto-news'));
    crypto_news_bot.telegram.setWebhook(
        `${process.env.GLOBLE_DOMAIN}/telegram-webhook-for-crypto-news`
    );
}

// Initialize and launch Message Auto Save and Post and delete bot only if MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV is not 'development'
if (process.env.MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV && process.env.MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV !== 'development') {
    const message_auto_save_and_post_bot = new Telegraf(process.env.BOT_TOKEN_MESSAGE_AUTO_SAVE_AND_POST);
    message_auto_save_and_post(message_auto_save_and_post_bot);

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-message-auto-save-and-post', message_auto_save_and_post_bot.webhookCallback('/telegram-webhook-for-message-auto-save-and-post'));
    message_auto_save_and_post_bot.telegram.setWebhook(
        `${process.env.GLOBLE_DOMAIN}/telegram-webhook-for-message-auto-save-and-post`
    );
}

// Initialize and launch Movies Hub if MOVIES_HUB_NODE_ENV is not 'development'
if (process.env.MOVIES_HUB_NODE_ENV && process.env.MOVIES_HUB_NODE_ENV !== 'development') {
    const movies_hub_bot = new Telegraf(process.env.BOT_TOKEN_MOVIEHUB);
    movies_hub_all_actions(movies_hub_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-movies-hub', movies_hub_bot.webhookCallback('/telegram-webhook-for-movies-hub'));
    movies_hub_bot.telegram.setWebhook(
        `${process.env.GLOBLE_DOMAIN}/telegram-webhook-for-movies-hub`
    );
}

// Initialize and launch Group Help advance if GROUP_HELP_ADVANCE_NODE_ENV is not 'development'
if (process.env.GROUP_HELP_ADVANCE_NODE_ENV && process.env.GROUP_HELP_ADVANCE_NODE_ENV !== 'development') {
    const group_help_advance_bot = new Telegraf(process.env.BOT_TOKEN_GROUP_HELP_ADVANCE);
    group_help_advance_all_actions(group_help_advance_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-group-help-advance', group_help_advance_bot.webhookCallback('/telegram-webhook-for-group-help-advance'));
    group_help_advance_bot.telegram.setWebhook(
        `${process.env.GLOBLE_DOMAIN}/telegram-webhook-for-group-help-advance`
    );
}

app.get('/', (req, res) => {
    try {
        const param = req.query?.tgWebAppStartParam;
        if (!param) {
            return res.send('✅ Bot is alive!');
        }

        // Decode and split the parameter
        const decodedParam = atob(param);
        const parts = decodedParam.split(':');
        const [miniAppOrBotType, type, query, fromId, userId] = parts;

        if (miniAppOrBotType !== 'movies-hub') {
            return res.send('✅ Bot is alive!');
        }

        // Define the base path using a secure token (ensure this variable exists)
        const basePath = `/${movies_hub_token}/movies-hub`;

        // Handle redirection based on `type`
        switch (type) {
            case 'movies':
                return res.redirect(`${basePath}/find-movies/${encodeURIComponent(query)}?userId=${encodeURIComponent(userId)}&fromId=${encodeURIComponent(fromId)}`);
            case 'shows':
                return res.redirect(`${basePath}/find-shows/${encodeURIComponent(query)}?userId=${encodeURIComponent(userId)}&fromId=${encodeURIComponent(fromId)}`);
            case 'request':
                return res.redirect(`${basePath}/send-request/${encodeURIComponent(query)}?userId=${encodeURIComponent(userId)}&fromId=${encodeURIComponent(fromId)}`);
            default:
                return res.send('✅ Bot is alive!');
        }
    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(400).send('❌ Invalid or corrupted parameters.');
    }
});

// all miniapp custom middleware
app.use('/:token', (req, res, next) => {
    const tokenName = req.params.token;
    let token_array = [
        promoX_token,
        movies_hub_token
    ]
    if (!token_array.includes(tokenName)) {
        res.render('404', { error_message: 'You are not allowed' });
    } else {
        next();
    }
});

app.use(`/${promoX_token}`, promoX_routes)
app.use(`/${movies_hub_token}`, movies_hub_routes)

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