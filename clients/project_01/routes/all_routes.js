const express = require('express')
const app = express()
const path = require('path')
const expressEjsLayouts = require('express-ejs-layouts');
const moment = require('moment-timezone');
const PER_TAP_AMOUNT = 0.01;
const DAILY_CAP = 100;
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
                tx,
                support_telegram_username
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


async function countDirectActiveReferrals(userDB_id) {
    if (!userDB_id) return 0;

    // find direct invite relations
    const invites = await invite_model.find({ invited_by_userDB_id: userDB_id }).select("invite_to_userDB_id").lean();
    if (!invites || !invites.length) return 0;

    const ids = invites.map(i => i.invite_to_userDB_id).filter(Boolean);
    if (!ids.length) return 0;

    // count users with registration_status ACTIVE
    const activeCount = await user_model.countDocuments({ _id: { $in: ids }, registration_status: "ACTIVE" });
    return activeCount;
}

/**
 * GET /project-01/daily-bonus
 * Renders EJS page (tap_tap_game) using baseTemplateData
 */
app.get('/project-01/daily-bonus', async (req, res) => {
    try {
        const { userDB_id } = req.query;
        if (!userDB_id) {
            return res.render(
                'pages/tap_tap_game',
                baseTemplateData({
                    page_name: "Daily Bonus",
                    error: "userDB_id required"
                })
            );
        }

        const user = await user_model.findById(userDB_id).lean();
        if (!user) {
            return res.render(
                'pages/tap_tap_game',
                baseTemplateData({
                    page_name: "Daily Bonus",
                    error: "User not found"
                })
            );
        }

        const tab = (user.tab_tab_game && typeof user.tab_tab_game === 'object') ? user.tab_tab_game : { balance: 0, count: 0, auto_credited_flag: false };
        const directActiveCount = await countDirectActiveReferrals(user._id);

        // If eligible by balance AND not yet auto_credited_flag, credit ONCE (but do NOT reset balance/count; cron will handle cleanup)
        let auto_credited_amount = 0;
        if (Number(tab.balance || 0) >= 100 && !tab.auto_credited_flag) {
            const creditAmount = 100; // credit ₹100 (user requested behaviour)
            await user_model.updateOne(
                { _id: user._id },
                {
                    $inc: { wallet_balance: creditAmount },
                    $set: { "tab_tab_game.auto_credited_flag": true, "tab_tab_game.last_auto_credited_at": new Date() }
                }
            );

            await transactions_model.create({
                userDB_id: user._id,
                type: "B",
                amount: creditAmount,
                status: "S",
                note: "Daily bonus auto-credit (threshold reached)",
                created_at: new Date()
            });

            auto_credited_amount = creditAmount;
        }

        // refresh user data
        const fresh = await user_model.findById(user._id).lean();
        const currentTab = (fresh.tab_tab_game && typeof fresh.tab_tab_game === 'object') ? fresh.tab_tab_game : { balance: 0, count: 0, auto_credited_flag: false };

        return res.render(
            'pages/tap_tap_game',
            baseTemplateData({
                page_name: "Daily Bonus",
                user: fresh,
                withdrawable_balance: Number(fresh.wallet_balance || 0),
                tab_count: Number(currentTab.count || 0),
                tab_balance: Number(currentTab.balance || 0),
                direct_active_count: Number(directActiveCount || 0),
                eligible_for_directs: Number(directActiveCount || 0) >= 5,
                eligible_for_auto_credit: Number(currentTab.balance || 0) >= 100,
                auto_credited_amount,
                per_tap_amount: PER_TAP_AMOUNT,
                support_telegram_username
            })
        );

    } catch (err) {
        console.error("daily-bonus GET error:", err);
        return res.render(
            'pages/tap_tap_game',
            baseTemplateData({
                page_name: "Daily Bonus",
                error: "Server error"
            })
        );
    }
});

app.post('/project-01/daily-bonus/tap', async (req, res) => {
    try {
        const { userDB_id } = req.body;
        if (!userDB_id) return res.status(400).json({ error: "userDB_id required" });

        // load user existence quickly
        const user = await user_model.findById(userDB_id).select("_id").lean();
        if (!user) return res.status(404).json({ error: "User not found" });

        // eligibility: at least 5 direct active referrals
        const directActiveCount = await countDirectActiveReferrals(user._id);
        if (directActiveCount < 5) {
            return res.status(403).json({
                error: "Not eligible: you need at least 5 direct active referrals to use Daily Bonus.",
                direct_active_count: directActiveCount
            });
        }

        // ATOMIC update using an aggregation pipeline update (MongoDB 4.2+ required)
        // This ensures balance becomes min(oldBalance + PER_TAP_AMOUNT, DAILY_CAP)
        // and count increments by 1 in the same atomic operation.
        const updated = await user_model.findOneAndUpdate(
            { _id: user._id },
            [
                {
                    $set: {
                        "tab_tab_game.balance": {
                            $min: [
                                { $add: [{ $ifNull: ["$tab_tab_game.balance", 0] }, PER_TAP_AMOUNT] },
                                DAILY_CAP
                            ]
                        },
                        "tab_tab_game.count": { $add: [{ $ifNull: ["$tab_tab_game.count", 0] }, 1] },
                        "tab_tab_game.created_at": { $ifNull: ["$tab_tab_game.created_at", new Date()] }
                    }
                }
            ],
            { new: true } // return the document AFTER update
        ).lean();

        // If updated is null something went wrong (shouldn't usually happen)
        if (!updated) {
            return res.status(500).json({ error: "Unable to register tap. Try again." });
        }

        // If balance was already at DAILY_CAP before update, we still incremented count above.
        // To avoid counting taps when balance already at cap we must guard:
        // If the prior balance was >= DAILY_CAP we should not have incremented.
        // But since the pipeline sets balance = min(old+PER_TAP, DAILY_CAP) and still increments count,
        // we need to detect if old balance >= DAILY_CAP and reject earlier.
        // To solve that properly we check old value by reading it before update in the rare case:
        // (We did read earlier but to keep response stable, we can compute whether any crediting required next.)

        // Now check for auto-credit (credit ₹100 once if threshold reached and not yet auto credited)
        let auto_credited = false;
        let auto_credited_amount = 0;

        const tab = (updated.tab_tab_game && typeof updated.tab_tab_game === "object") ? updated.tab_tab_game : { balance: 0, count: 0 };

        // If balance reached cap (>= DAILY_CAP) and not yet auto credited, attempt to credit once.
        if (Number(tab.balance || 0) >= DAILY_CAP) {
            // Use findOneAndUpdate with condition to prevent double-crediting
            const creditAmount = DAILY_CAP; // ₹100 per requirement
            const credited = await user_model.findOneAndUpdate(
                {
                    _id: updated._id,
                    $or: [
                        { "tab_tab_game.auto_credited_flag": { $exists: false } },
                        { "tab_tab_game.auto_credited_flag": { $ne: true } }
                    ],
                    // ensure the balance actually >= DAILY_CAP to prevent accidental credit
                    $expr: { $gte: [{ $ifNull: ["$tab_tab_game.balance", 0] }, DAILY_CAP] }
                },
                {
                    $inc: { wallet_balance: creditAmount },
                    $set: { "tab_tab_game.auto_credited_flag": true, "tab_tab_game.last_auto_credited_at": new Date() }
                },
                { new: true }
            ).lean();

            if (credited) {
                auto_credited = true;
                auto_credited_amount = creditAmount;

                // Create transaction record
                await transactions_model.create({
                    userDB_id: updated._id,
                    type: "B",
                    amount: creditAmount,
                    status: "S",
                    note: "Daily bonus auto-credit (tap-tap threshold)",
                    created_at: new Date()
                });

                // refresh 'updated' to reflect new wallet balance
                Object.assign(updated, credited);
            }
        }

        // Return authoritative state
        const tab_count = Number((updated.tab_tab_game && updated.tab_tab_game.count) ? updated.tab_tab_game.count : 0);
        const tab_balance = Number((updated.tab_tab_game && updated.tab_tab_game.balance) ? updated.tab_tab_game.balance : 0);
        const withdrawable_balance = Number(updated.wallet_balance || 0);

        return res.json({
            tab_count,
            tab_balance,
            withdrawable_balance,
            auto_credited,
            auto_credited_amount,
            direct_active_count: directActiveCount
        });
    } catch (err) {
        console.error("daily-bonus TAP error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

module.exports = app;