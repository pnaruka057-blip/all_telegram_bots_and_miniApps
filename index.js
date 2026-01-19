require('dotenv').config()
let promoX_token = process.env.PROMOX_TOKEN
let movies_hub_token = process.env.MOVIES_HUB_TOKEN
let group_help_advance_token = process.env.GROUP_HELP_ADVANCE_TOKEN
let project_01_token = process.env.PROJECT_01_TOKEN
const express = require('express')
const app = express()
const { Telegraf } = require('telegraf');
const path = require('path')
const cors = require('cors');
const cookieParser = require('cookie-parser');
const promoX_routes = require('./own_projects/PromoX/routes/all_routes')
const movies_hub_routes = require('./own_projects/movies_hub/routes/all_routes')
const promoX_all_actions = require('./own_projects/PromoX/promoX_bot')
const movies_hub_all_actions = require('./own_projects/movies_hub/bot_index')
const group_help_advance_routes = require('./own_projects/Group_help_advance/routes/all_routes')
const project_01_routes = require('./clients/project_01/routes/all_routes')
const group_help_advance_all_actions = require('./own_projects/Group_help_advance/bot_index')
const project_01 = require('./clients/project_01/bot_index')
const project_02 = require('./clients/project_02/bot_index')
const globle_domain = process.env.GLOBLE_DOMAIN
const LOG = require('./globle_helper/logger')

// all system middleware
app.use(cors())
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// all set
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'public'));


if (process.env.PROMOX_NODE_ENV && process.env.PROMOX_NODE_ENV !== 'development') {
    const promoX_bot = new Telegraf(process.env.BOT_TOKEN_PROMOX);
    promoX_all_actions(promoX_bot);

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-promox', promoX_bot.webhookCallback('/telegram-webhook-for-promox'));
    promoX_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-promox`
    );
}

if (process.env.MOVIES_HUB_NODE_ENV && process.env.MOVIES_HUB_NODE_ENV !== 'development') {
    const movies_hub_bot = new Telegraf(process.env.BOT_TOKEN_MOVIEHUB);
    movies_hub_all_actions(movies_hub_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-movies-hub', movies_hub_bot.webhookCallback('/telegram-webhook-for-movies-hub'));
    movies_hub_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-movies-hub`
    );
}

if (process.env.GROUP_HELP_ADVANCE_NODE_ENV && process.env.GROUP_HELP_ADVANCE_NODE_ENV !== 'development') {
    const group_help_advance_bot = new Telegraf(process.env.BOT_TOKEN_GROUP_HELP_ADVANCE);
    group_help_advance_all_actions(group_help_advance_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-group-help-advance', group_help_advance_bot.webhookCallback('/telegram-webhook-for-group-help-advance'));
    group_help_advance_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-group-help-advance`
    );
}

if (process.env.PROJECT_01_NODE_ENV && process.env.PROJECT_01_NODE_ENV !== 'development') {
    const project_01_bot = new Telegraf(process.env.BOT_TOKEN_PROJECT_01);
    project_01(project_01_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-project-01', project_01_bot.webhookCallback('/telegram-webhook-for-project-01'));
    project_01_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-project-01`
    );
}

if (process.env.PROJECT_02_NODE_ENV && process.env.PROJECT_02_NODE_ENV !== 'development') {
    const project_02_bot = new Telegraf(process.env.BOT_TOKEN_PROJECT_02);
    project_02(project_02_bot)

    // Webhook binding (specific route)
    app.post('/telegram-webhook-for-project-02', project_02_bot.webhookCallback('/telegram-webhook-for-project-02'));
    project_02_bot.telegram.setWebhook(
        `${globle_domain}/telegram-webhook-for-project-02`
    );
}

app.get("/my-ip", async (req, res) => {
    try {
        const r = await fetch("https://api.ipify.org?format=json");
        const data = await r.json();
        res.json({
            railway_detected_public_ip: data.ip
        });
    } catch (e) {
        res.status(500).json({ error: "Unable to fetch IP" });
    }
});

app.get('/', (req, res) => {
    try {
        const param = req.query?.tgWebAppStartParam;
        if (!param) {
            return res.send('✅ Bot is alive! but param not found');
        }

        // Decode and split the parameter
        const decodedParam = atob(param);
        const parts = decodedParam.split(':');
        const [miniAppOrBotType] = parts;


        switch (miniAppOrBotType) {
            /* ================= MOVIES HUB ================= */
            case 'movies-hub': {
                const basePath = `/${movies_hub_token}/movies-hub`;
                const [_, type, query, fromId, userId] = parts;
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

            /* ================= GROUP HELP ADVANCE ================= */
            case 'group-help-advance': {
                const basePath = `/${group_help_advance_token}/group-help-advance`;
                const [_, type] = parts;
                if (type === 'text-message-design') {
                    return res.redirect(`${basePath}/html_message_design`);
                }

                if (type === 'text-message-design-with-placeholders') {
                    return res.redirect(`${basePath}/html_message_design?placeholders=true`);
                }

                if (type === 'btn-design') {
                    return res.redirect(`${basePath}/buttons-design`);
                }

                if (type === 'privacy-policy') {
                    return res.redirect(`${basePath}/privacy-policy`);
                }

                return res.redirect(`${basePath}`);
            }

            /* ================= Project 01 ================= */
            case 'project-01': {
                const basePath = `/${project_01_token}/project-01`;
                const [_, type, userDB_id] = parts;
                if (type === 'team-report') {
                    return res.redirect(`${basePath}/team-report?userDB_id=${userDB_id}`);
                }

                if (type === 'transactions-report') {
                    return res.redirect(`${basePath}/transactions-report?userDB_id=${userDB_id}`);
                }

                if (type === 'daily-bonus') {
                    return res.redirect(`${basePath}/daily-bonus?userDB_id=${userDB_id}`);
                }

                if (type === 'admin') {
                    return res.redirect(`${basePath}/admin`);
                }

                return res.redirect(`${basePath}`);
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

// all miniapp custom middleware
app.use('/:token', (req, res, next) => {
    const tokenName = req.params.token;
    let token_array = [
        promoX_token,
        movies_hub_token,
        group_help_advance_token,
        project_01_token
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
app.use(`/${project_01_token}`, project_01_routes)

// Express app to keep server alive
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
    LOG(`Server running on port ${PORT}`);
    console.log("Server running on port", PORT);
});

// Global Error Handlers (So one bot’s error doesn't crash others)
process.on('uncaughtException', (err) => {
    console.error('🔥 Uncaught Exception:', err);
    LOG('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠ Unhandled Rejection:', reason);
    LOG('⚠ Unhandled Rejection:', reason);
});