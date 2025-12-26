require('dotenv').config()
let promoX_token = process.env.PROMOX_TOKEN
let movies_hub_token = process.env.MOVIES_HUB_TOKEN
let group_help_advance_token = process.env.GROUP_HELP_ADVANCE_TOKEN
const express = require('express')
const app = express()
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const path = require('path')
const cors = require('cors');
const cookieParser = require('cookie-parser');
const promoX_routes = require('./clients/PromoX/routes/all_routes')
const movies_hub_routes = require('./own_projects/movies_hub/routes/all_routes')
const group_help_advance_routes = require('./own_projects/Group_help_advance/routes/all_routes')
const promoX_all_actions = require('./clients/PromoX/bot_handler/promoX_bot')
const message_auto_save_and_post = require('./clients/rv_saini/Message_auto_save_and_post/message_auto_save_and_post')
const crypto_news_all_actions = require('./clients/mr_akash/Crypto_news/crypto_news_bot')
const movies_hub_all_actions = require('./own_projects/movies_hub/bot_index')
const group_help_advance_all_actions = require('./own_projects/Group_help_advance/bot_index')
const Checker_Gái_Đẹp_all_actions = require('./clients/co_tat_ca_20usdt_10usdt_per_month/co_tat_ca_20usdt_10usdt_per_month')
const Whatsapp_group_message_auto_save_and_post = require('./clients/rv_saini/Whatsapp_group_message_auto_save_and_post/Whatsapp_group_message_auto_save_and_post')
const techboost_it_services = require('./own_projects/Techboost_it_services/Reciept_genrator')
const globle_domain = process.env.GLOBLE_DOMAIN
const crypto = require("crypto");

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
        `${globle_domain}/telegram-webhook-for-promox`
    );
}

// Initialize and launch Crypto News bot only if CRYPTO_NEWS_NODE_ENV is not 'development'
if (process.env.CRYPTO_NEWS_NODE_ENV && process.env.CRYPTO_NEWS_NODE_ENV !== 'development') {
    const crypto_news_bot = new Telegraf(process.env.BOT_TOKEN_CRYPTO_NEWS);
    crypto_news_all_actions(crypto_news_bot);

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-crypto-news', crypto_news_bot.webhookCallback('/telegram-webhook-for-crypto-news'));
    crypto_news_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-crypto-news`
    );
}

// Initialize and launch Message Auto Save and Post and delete bot only if MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV is not 'development'
if (process.env.MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV && process.env.MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV !== 'development') {
    const message_auto_save_and_post_bot = new Telegraf(process.env.BOT_TOKEN_MESSAGE_AUTO_SAVE_AND_POST);
    message_auto_save_and_post(message_auto_save_and_post_bot);

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-message-auto-save-and-post', message_auto_save_and_post_bot.webhookCallback('/telegram-webhook-for-message-auto-save-and-post'));
    message_auto_save_and_post_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-message-auto-save-and-post`
    );
}

// Initialize and launch Movies Hub if MOVIES_HUB_NODE_ENV is not 'development'
if (process.env.MOVIES_HUB_NODE_ENV && process.env.MOVIES_HUB_NODE_ENV !== 'development') {
    const movies_hub_bot = new Telegraf(process.env.BOT_TOKEN_MOVIEHUB);
    movies_hub_all_actions(movies_hub_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-movies-hub', movies_hub_bot.webhookCallback('/telegram-webhook-for-movies-hub'));
    movies_hub_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-movies-hub`
    );
}

// Initialize and launch Group Help advance if GROUP_HELP_ADVANCE_NODE_ENV is not 'development'
if (process.env.GROUP_HELP_ADVANCE_NODE_ENV && process.env.GROUP_HELP_ADVANCE_NODE_ENV !== 'development') {
    const group_help_advance_bot = new Telegraf(process.env.BOT_TOKEN_GROUP_HELP_ADVANCE);
    group_help_advance_all_actions(group_help_advance_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-group-help-advance', group_help_advance_bot.webhookCallback('/telegram-webhook-for-group-help-advance'));
    group_help_advance_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-group-help-advance`
    );
}

// Initialize and launch Checker Gái Đẹp if CHECKER_GAI_DEP_NODE_ENV is not 'development'
if (process.env.CHECKER_GAI_DEP_NODE_ENV && process.env.CHECKER_GAI_DEP_NODE_ENV !== 'development') {
    const checker_gai_dep_bot = new Telegraf(process.env.BOT_TOKEN_CHECKER_GAI_DEP);
    Checker_Gái_Đẹp_all_actions(checker_gai_dep_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-checker-gai-dep', checker_gai_dep_bot.webhookCallback('/telegram-webhook-for-checker-gai-dep'));
    checker_gai_dep_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-checker-gai-dep`
    );
}

// Initialize and launch Checker Gái Đẹp if WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV is not 'development'
if (process.env.WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV && process.env.WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST_NODE_ENV !== 'development') {
    const Whatsapp_group_message_auto_save_and_post_bot = new Telegraf(process.env.BOT_TOKEN_WHATSAPP_GROUP_MESSAGE_AUTO_SAVE_AND_POST);
    Whatsapp_group_message_auto_save_and_post(Whatsapp_group_message_auto_save_and_post_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-Whatsapp-group-message-auto-save-and-post', Whatsapp_group_message_auto_save_and_post_bot.webhookCallback('/telegram-webhook-for-Whatsapp-group-message-auto-save-and-post'));
    Whatsapp_group_message_auto_save_and_post_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-Whatsapp-group-message-auto-save-and-post`
    );
}

// Initialize and launch TechBoost IT Services recipts if TECHBOOST_IT_SERVICES_NODE_ENV is not 'development'
if (process.env.TECHBOOST_IT_SERVICES_NODE_ENV && process.env.TECHBOOST_IT_SERVICES_NODE_ENV !== 'development') {
    const techboost_it_services_bot = new Telegraf(process.env.BOT_TOKEN_TECHBOOST_IT_SERVICES);
    techboost_it_services(techboost_it_services_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-techboost-it-services', techboost_it_services_bot.webhookCallback('/telegram-webhook-for-techboost-it-services'));
    techboost_it_services_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-techboost-it-services`
    );
}

app.get('/', (req, res) => {
    try {
        const param = req.query?.tgWebAppStartParam;
        if (!param) {
            return res.send('✅ Bot is alive! but param now found');
        }

        // Decode and split the parameter
        const decodedParam = atob(param);
        const parts = decodedParam.split(':');
        const [miniAppOrBotType, type, query, fromId, userId] = parts;

        switch (miniAppOrBotType) {

            /* ================= MOVIES HUB ================= */
            case 'movies-hub': {
                const basePath = `/${movies_hub_token}/movies-hub`;

                switch (type) {
                    case 'movies':
                        return res.redirect(
                            `${basePath}/find-movies/${encodeURIComponent(query)}?userId=${encodeURIComponent(userId)}&fromId=${encodeURIComponent(fromId)}`
                        );

                    case 'shows':
                        return res.redirect(
                            `${basePath}/find-shows/${encodeURIComponent(query)}?userId=${encodeURIComponent(userId)}&fromId=${encodeURIComponent(fromId)}`
                        );

                    case 'request':
                        return res.redirect(
                            `${basePath}/send-request/${encodeURIComponent(query)}?userId=${encodeURIComponent(userId)}&fromId=${encodeURIComponent(fromId)}`
                        );

                    default:
                        return res.send('✅ Bot is alive! but unknown type');
                }
            }

            /* ================= PROMOX ================= */
            case 'promox': {
                const basePath = `/${promoX_token}/promox`;

                // Example (future ready)
                if (type === 'campaign') {
                    return res.redirect(
                        `${basePath}/campaign/${encodeURIComponent(query)}`
                    );
                }

                return res.send('✅ Bot is alive! but unknown type');
            }

            /* ================= GROUP HELP ADVANCE ================= */
            case 'group-help-advance': {
                const basePath = `/${group_help_advance_token}/group-help-advance`;

                if (type === 'text-design') {
                    return res.redirect(`${basePath}/text-message-design`);
                }

                if (type === 'buttons-design') {
                    return res.redirect(`${basePath}/buttons-design`);
                }

                return res.send('✅ Bot is alive! but unknown type');
            }

            /* ================= UNKNOWN BOT ================= */
            default:
                return res.send('✅ Bot is alive! but unknown mini app or bot type');
        }
    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(400).send('❌ Invalid or corrupted parameters.');
    }
});

app.post("/group-help-advance/init", async (req, res) => {
    try {
        const { initData, startParam } = req.body;

        // 🔴 initData mandatory
        if (!initData) {
            return res.status(400).json({
                error: "Missing initData"
            });
        }

        // 🔐 Telegram initData verification (INLINE)
        const BOT_TOKEN = process.env.BOT_TOKEN_GROUP_HELP_ADVANCE;

        const urlParams = new URLSearchParams(initData);
        const hash = urlParams.get("hash");

        if (!hash) {
            return res.status(403).json({
                error: "Invalid Telegram data"
            });
        }

        urlParams.delete("hash");

        const dataCheckString = [...urlParams.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join("\n");

        const secretKey = crypto
            .createHmac("sha256", "WebAppData")
            .update(BOT_TOKEN)
            .digest();

        const calculatedHash = crypto
            .createHmac("sha256", secretKey)
            .update(dataCheckString)
            .digest("hex");

        if (calculatedHash !== hash) {
            return res.status(403).json({
                error: "Telegram verification failed"
            });
        }

        // ✅ Telegram user extract
        const tgUser = JSON.parse(urlParams.get("user"));

        // 🔑 Token (ENV based – your existing architecture)
        const group_help_advance_token =
            process.env.GROUP_HELP_ADVANCE_TOKEN;

        if (!group_help_advance_token) {
            return res.status(500).json({
                error: "Server token not configured"
            });
        }

        // (Optional) log / save session here if needed
        // console.log("MiniApp access:", tgUser.id, startParam);

        // ✅ ONLY token response
        return res.json({
            group_help_advance_token
        });

    } catch (error) {
        console.error("Group Help Advance init error:", error);
        return res.status(500).json({
            error: "Internal server error"
        });
    }
});

// all miniapp custom middleware
app.use('/:token', (req, res, next) => {
    const tokenName = req.params.token;
    let token_array = [
        promoX_token,
        movies_hub_token,
        group_help_advance_token
    ]
    if (!token_array.includes(tokenName)) {
        res.render('404', { error_message: 'You are not allowed' });
    } else {
        next();
    }
});

app.use(`/${promoX_token}`, promoX_routes)
app.use(`/${movies_hub_token}`, movies_hub_routes)
app.use(`/${group_help_advance_token}`, group_help_advance_routes)

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