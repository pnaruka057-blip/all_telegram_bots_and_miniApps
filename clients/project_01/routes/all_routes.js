const express = require('express')
const app = express()
const path = require('path')
const expressEjsLayouts = require('express-ejs-layouts');
const moment = require('moment-timezone');

let project_01_token = process.env.PROJECT_01_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME
const support_telegram_username = process.env.SUPPORT_TELEGRAM_USERNAME

const user_model = require("../models/user_module");
const invite_model = require("../models/invite_model");
const transactions_model = require("../models/transactions_model");

app.use(express.static(path.join(__dirname, '..', "public")))
app.use(expressEjsLayouts);

app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, '..', 'public', 'views'));
app.set('layout', path.resolve(__dirname, '..', 'public', 'views', 'layout'));

// Helper IST formatter
const toISTDate = (d) =>
    moment(d).tz("Asia/Kolkata").format("DD MMM YYYY");

const toISTDateTime = (d) =>
    moment(d).tz("Asia/Kolkata").format("DD MMM YYYY, hh:mm A");


/**
 * USER
 */
async function fetchUser(userDB_id) {
    if (!userDB_id) return null;

    try {
        const u = await user_model
            .findById(userDB_id)
            .select("first_name last_name username wallet_balance invite_code registration_status created_at")
            .lean();

        if (!u) return null;

        // Convert created_at to IST formatted value
        u.joined_at_ist = u.created_at ? toISTDate(u.created_at) : null;

        return u;

    } catch {
        return null;
    }
}

function baseTemplateData(extra = {}) {
    return {
        developer_telegram_username,
        token: project_01_token,
        ...extra
    };
}


/**
 * TEAM LEVEL BUILD
 */
async function buildTeamLevels(userDB_id) {

    let current = [String(userDB_id)];
    const levels = [];
    let totalUsers = 0;

    for (let lvl = 1; lvl <= 7; lvl++) {

        const invites = await invite_model
            .find({ invited_by_userDB_id: { $in: current } })
            .select("invite_to_userDB_id")
            .lean();

        if (!invites.length) break;

        const next = invites.map(x => String(x.invite_to_userDB_id));

        levels.push({
            level: lvl,
            users: next.length,
            earnings: 0
        });

        totalUsers += next.length;
        current = next;
    }

    return { levels, totalUsers };
}


/**
 * LEVEL EARNINGS (Transaction based — IST safe)
 */
async function applyLevelEarnings(userDB_id, levels) {

    for (const lvl of levels) {

        const tx = await transactions_model
            .find({
                userDB_id: userDB_id,
                type: "I",
                note: { $regex: new RegExp(`Level\\s*${lvl.level}\\b`, "i") }
            })
            .select("amount created_at")
            .lean();

        const sum = tx.reduce((s, t) => s + (Number(t.amount) || 0), 0);

        lvl.earnings = Number(sum.toFixed(2));
    }

    return levels;
}


/**
 * TOTAL EARNINGS
 */
async function computeTotalEarnings(userDB_id) {

    const tx = await transactions_model
        .find({ userDB_id, type: "I" })
        .select("amount")
        .lean();

    return Number(
        tx.reduce((s, t) => s + (Number(t.amount) || 0), 0).toFixed(2)
    );
}


/**
 * TEAM REPORT
 */
async function fetchTeamReport(userDB_id) {

    const { levels, totalUsers } = await buildTeamLevels(userDB_id);

    const levelsWithEarnings = await applyLevelEarnings(userDB_id, levels);

    const totalEarnings = await computeTotalEarnings(userDB_id);

    return {
        total_directs: levelsWithEarnings[0]?.users || 0,
        total_team: totalUsers,
        total_earnings: totalEarnings,
        levels: levelsWithEarnings
    };
}


/**
 * TRANSACTIONS (converted to IST)
 */
async function fetchTransactions(userDB_id) {

    const tx = await transactions_model
        .find({ userDB_id })
        .sort({ created_at: -1 })
        .lean();

    // Convert timestamps to IST display format
    const mapped = tx.map(t => ({
        ...t,
        created_at_ist: t.created_at ? toISTDateTime(t.created_at) : null
    }));

    return {
        total_commission: mapped
            .filter(t => t.type === "I")
            .reduce((s, t) => s + (Number(t.amount) || 0), 0),

        total_withdrawn: mapped
            .filter(t => t.type === "W")
            .reduce((s, t) => s + (Number(t.amount) || 0), 0),

        transactions: mapped
    };
}


/**
 * TEAM REPORT PAGE
 */
app.get('/project-01/team-report', async (req, res) => {
    try {
        const { userDB_id } = req.query;

        const user = await fetchUser(userDB_id);
        const team = await fetchTeamReport(userDB_id);

        return res.render(
            'pages/team_report',
            baseTemplateData({
                page_name: "Team Report",
                user,
                team,
                support_telegram_username
            })
        );

    } catch (err) {
        console.error("TEAM REPORT ERROR:", err);

        return res.render(
            'pages/team_report',
            baseTemplateData({
                page_name: "Team Report",
                error: "Unable to load team report"
            })
        );
    }
});


/**
 * TRANSACTIONS REPORT PAGE
 */
app.get('/project-01/transactions-report', async (req, res) => {
    try {
        const { userDB_id } = req.query;

        const user = await fetchUser(userDB_id);
        if (!user) {
            return res.render(
                'pages/transactions_report',
                baseTemplateData({
                    page_name: "Transactions Report",
                    error: "User not found"
                })
            );
        }

        const tx = await fetchTransactions(userDB_id);

        return res.render(
            'pages/transactions_report',
            baseTemplateData({
                page_name: "Transactions Report",
                user,
                tx
            })
        );

    } catch (err) {

        console.error("TRANSACTIONS REPORT ERROR:", err);

        return res.render(
            'pages/transactions_report',
            baseTemplateData({
                page_name: "Transactions Report",
                error: "Unable to load transactions"
            })
        );
    }
});


module.exports = app;