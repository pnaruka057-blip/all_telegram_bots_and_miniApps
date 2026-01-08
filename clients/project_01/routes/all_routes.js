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
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");
const user_model = require("../models/user_module");
const invite_model = require("../models/invite_model");
const transactions_model = require("../models/transactions_model");
const other_model = require("../models/other_model");
const { Telegraf } = require('telegraf');
const mongoose = require("mongoose")
const { verifyCallback } = require("../helpers/watchpay");

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

let project_01_bot;

if (process.env.PROJECT_01_NODE_ENV && process.env.PROJECT_01_NODE_ENV !== "development") {
    project_01_bot = new Telegraf(process.env.BOT_TOKEN_PROJECT_01);
}

// WatchPay deposit notify (x-www-form-urlencoded)
app.post("/project-01/watchpay/notify/deposit", express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const paymentKey = process.env.WATCHPAY_PAYMENT_KEY_TEST;
        console.log(paymentKey);
        if (!paymentKey) return res.status(500).send("fail");

        const body = req.body || {};

        // verify sign
        const ok = verifyCallback(body, paymentKey);
        if (!ok) return res.status(401).send("fail");

        const mchOrderNo = body.mchOrderNo || body.mch_order_no || "";
        const tradeResult = String(body.tradeResult || "");

        if (!mchOrderNo) return res.status(400).send("fail");

        // tradeResult=1 => success (as per your doc text)
        if (tradeResult === "1") {
            await transactions_model.updateOne(
                { gateway: "WATCHPAY", mch_order_no: mchOrderNo, type: "D" },
                {
                    $set: {
                        status: "S",
                        trade_result: tradeResult,
                        gateway_order_no: body.orderNo || "",
                        raw_callback: body,
                    },
                }
            );
        } else {
            await transactions_model.updateOne(
                { gateway: "WATCHPAY", mch_order_no: mchOrderNo, type: "D" },
                {
                    $set: {
                        status: "R",
                        trade_result: tradeResult,
                        raw_callback: body,
                        note: "Deposit failed/rejected (WatchPay)",
                    },
                }
            );
        }

        // IMPORTANT: must return "success" to stop retries
        return res.send("success");
    } catch (err) {
        console.error("watchpay notify error:", err);
        return res.status(500).send("fail");
    }
});

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

        const tab = (user.tab_tab_game && typeof user.tab_tab_game === 'object')
            ? user.tab_tab_game
            : { balance: 0, count: 0, auto_credited_flag: false };

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

            // refresh user data
            const fresh = await user_model.findById(user._id).lean();
            const currentTab = (fresh.tab_tab_game && typeof fresh.tab_tab_game === 'object')
                ? fresh.tab_tab_game
                : { balance: 0, count: 0, auto_credited_flag: false };

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
        }

        const currentTab = tab;

        return res.render(
            'pages/tap_tap_game',
            baseTemplateData({
                page_name: "Daily Bonus",
                user,
                withdrawable_balance: Number(user.wallet_balance || 0),
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

        // --- TRANSACTION START (POST optimization) ---
        const session = await project_01_connection.startSession();
        session.startTransaction();

        try {
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
                { new: true, session } // return the document AFTER update
            ).lean();

            // If updated is null something went wrong (shouldn't usually happen)
            if (!updated) {
                await session.abortTransaction();
                session.endSession();
                return res.status(500).json({ error: "Unable to register tap. Try again." });
            }

            // Now check for auto-credit (credit ₹100 once if threshold reached and not yet auto credited)
            let auto_credited = false;
            let auto_credited_amount = 0;

            const tab = (updated.tab_tab_game && typeof updated.tab_tab_game === "object")
                ? updated.tab_tab_game
                : { balance: 0, count: 0 };

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
                    { new: true, session }
                ).lean();

                if (credited) {
                    auto_credited = true;
                    auto_credited_amount = creditAmount;

                    // Create transaction record
                    await transactions_model.create([{
                        userDB_id: updated._id,
                        type: "B",
                        amount: creditAmount,
                        status: "S",
                        note: "Daily bonus auto-credit (tap-tap threshold)",
                        created_at: new Date()
                    }], { session });

                    // refresh 'updated' to reflect new wallet balance
                    Object.assign(updated, credited);
                }
            }

            await session.commitTransaction();
            session.endSession();

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

        } catch (txErr) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
            throw txErr;
        }
        // --- TRANSACTION END ---

    } catch (err) {
        console.error("daily-bonus TAP error:", err);
        return res.status(500).json({ error: "Server error" });
    }
});

// Reject reasons (unchanged)
const REJECT_REASONS = [
    { key: 'incorrect_upi', label: 'Incorrect UPI details' },
    { key: 'insufficient_kyc', label: 'Insufficient KYC / verification' },
    { key: 'fraud_suspicion', label: 'Fraud suspicion' },
    { key: 'other_contact', label: 'Other — contact support' }
];

/**
 * computeSummary() - deposits are derived from ACTIVE users * fixed deposit (1000)
 */
async function computeSummary() {
    const DEPOSIT_PER_USER = Number(process.env.FIRST_DEPOSIT_AMOUNT) || 1000;

    const total_users = await user_model.countDocuments();
    const activeUsersCount = await user_model.countDocuments({ registration_status: 'ACTIVE' });

    const total_deposit = Number((activeUsersCount * DEPOSIT_PER_USER).toFixed(2));

    // sum withdrawals and commissions from transactions_model
    const sumAgg = await transactions_model.aggregate([
        { $match: { type: { $in: ['W', 'I'] } } },
        { $group: { _id: '$type', total: { $sum: { $toDouble: '$amount' } } } }
    ]);

    let total_withdrawn = 0;
    let total_commission = 0;

    for (const r of (sumAgg || [])) {
        if (r._id === 'W') total_withdrawn = Number((r.total || 0).toFixed(2));
        if (r._id === 'I') total_commission = Number((r.total || 0).toFixed(2));
    }

    const total_users_first_deposit = activeUsersCount;
    const owner_profit = Number((total_deposit - total_commission - total_withdrawn).toFixed(2));

    return {
        total_users,
        total_users_first_deposit,
        total_deposit,
        total_withdrawn,
        total_commission,
        owner_profit
    };
}

/**
 * GET /project-01/admin (render page)
 */
app.get('/project-01/admin', async (req, res) => {
    try {
        const summary = await computeSummary();

        return res.render('pages/admin', {
            developer_telegram_username,
            token: project_01_token,
            page_name: 'Admin Dashboard',
            summary,
            // reject reasons list for the modal
            reject_reasons: REJECT_REASONS
        });

    } catch (err) {
        console.error('admin page error:', err);
        return res.status(500).send('Unable to load admin page');
    }
});

/**
 * JSON summary
 * GET /project-01/admin/summary
 */
app.get('/project-01/admin/summary', async (req, res) => {
    try {
        const summary = await computeSummary();
        return res.json({ ok: true, summary });
    } catch (err) {
        console.error('admin summary api error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * GET withdrawals
 * GET /project-01/admin/withdrawals?status=Pending&page=1&limit=50
 */
app.get('/project-01/admin/withdrawals', async (req, res) => {
    try {
        const statusMap = { All: null, Pending: 'P', Reject: 'R', Success: 'S' };
        const statusParam = req.query.status || 'Pending';
        const statusFilter = statusMap[statusParam] === null ? {} : { status: statusMap[statusParam] };

        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(10, Math.min(200, parseInt(req.query.limit || '50', 10)));
        const skip = (page - 1) * limit;

        const query = Object.assign({ type: 'W' }, statusFilter);

        const [items, total] = await Promise.all([
            transactions_model.find(query).sort({ created_at: 1 }).skip(skip).limit(limit).lean(),
            transactions_model.countDocuments(query)
        ]);

        // map created_at to IST and attach basic user info
        const userIds = [...new Set(items.map(it => String(it.userDB_id)))].filter(Boolean);
        let usersMap = {};

        if (userIds.length) {
            const users = await user_model.find({ _id: { $in: userIds } })
                .select('first_name last_name username user_id wallet_balance registration_status created_at')
                .lean();

            usersMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});
        }

        const rows = items.map(it => {
            const user = usersMap[String(it.userDB_id)] || null;
            return {
                ...it,
                created_at_ist: toISTDate(it.created_at),
                user
            };
        });

        return res.json({ ok: true, rows, meta: { total, page, limit } });

    } catch (err) {
        console.error('admin withdrawals api error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * Approve withdrawal
 * POST /project-01/admin/withdrawals/:txid/approve
 */
app.post('/project-01/admin/withdrawals/:txid/approve', async (req, res) => {
    try {
        const { txid } = req.params;

        if (!txid || !mongoose.Types.ObjectId.isValid(txid)) return res.status(400).json({ ok: false, error: 'Invalid txid' });

        // --- TRANSACTION START (POST optimization) ---
        const session = await project_01_connection.startSession();
        session.startTransaction();

        try {
            const tx = await transactions_model.findById(txid).session(session).lean();

            if (!tx || tx.type !== 'W') {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ ok: false, error: 'Withdrawal not found' });
            }

            if (tx.status !== 'P') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ ok: false, error: 'Withdrawal not in Pending status' });
            }

            await transactions_model.updateOne(
                { _id: txid },
                { $set: { status: 'S', admin_note: 'Approved by admin', processed_at: new Date() } },
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            return res.json({ ok: true, message: 'Withdrawal approved' });

        } catch (txErr) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
            throw txErr;
        }
        // --- TRANSACTION END ---

    } catch (err) {
        console.error('approve error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * Reject withdrawal
 * POST /project-01/admin/withdrawals/:txid/reject { reason: '' }
 */
app.post('/project-01/admin/withdrawals/:txid/reject', async (req, res) => {
    try {
        const { txid } = req.params;
        const reasonKey = (req.body && req.body.reason) ? String(req.body.reason) : '';

        if (!txid || !mongoose.Types.ObjectId.isValid(txid)) {
            return res.status(400).json({ ok: false, error: 'Invalid txid' });
        }

        if (!REJECT_REASONS.find(v => v.key === reasonKey)) {
            return res.status(400).json({ ok: false, error: 'Invalid reject reason' });
        }

        // --- TRANSACTION START (POST optimization) ---
        const session = await project_01_connection.startSession();
        session.startTransaction();

        try {
            // Fetch tx (must be a PENDING withdrawal)
            const tx = await transactions_model.findById(txid).session(session).lean();

            if (!tx || tx.type !== 'W') {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ ok: false, error: 'Withdrawal not found' });
            }

            if (tx.status !== 'P') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ ok: false, error: 'Withdrawal not in Pending status' });
            }

            const refundAmount = Number(tx.amount || 0);

            // 1) First — atomically set status → Rejected (only if still Pending)
            const updated = await transactions_model.updateOne(
                { _id: txid, status: 'P' }, // guard condition
                {
                    $set: {
                        status: 'R',
                        note: REJECT_REASONS[reasonKey],
                        processed_at: new Date()
                    }
                },
                { session }
            );

            // If update matched 0 docs → someone already processed it
            if (!updated.matchedCount) {
                await session.abortTransaction();
                session.endSession();
                return res.status(409).json({
                    ok: false,
                    error: 'Withdrawal already processed by someone else'
                });
            }

            // 2) Refund wallet safely
            if (refundAmount > 0) {
                await user_model.updateOne(
                    { _id: tx.userDB_id },
                    { $inc: { wallet_balance: refundAmount } },
                    { session }
                );
            }

            await session.commitTransaction();
            session.endSession();

            return res.json({
                ok: true,
                message: 'Withdrawal rejected and amount refunded',
                reason: REJECT_REASONS[reasonKey]
            });

        } catch (txErr) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
            throw txErr;
        }
        // --- TRANSACTION END ---

    } catch (err) {
        console.error('reject error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * GET users list (search + filter + pagination)
 * GET /project-01/admin/users?status=All&page=1&limit=30&search=
 *
 * status => All | Pending | Active (filters by registration_status)
 */
app.get('/project-01/admin/users', async (req, res) => {
    try {
        const statusParam = (req.query.status || 'All');
        const statusFilter = (statusParam === 'All')
            ? {}
            : { registration_status: (statusParam === 'Pending' ? 'PENDING' : (statusParam === 'Active' ? 'ACTIVE' : statusParam)) };

        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(10, Math.min(200, parseInt(req.query.limit || '30', 10)));
        const skip = (page - 1) * limit;

        const search = (req.query.search || '').trim();
        const searchQuery = {};

        if (search) {
            // search by username, first_name, last_name, user_id (partial)
            const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            searchQuery.$or = [
                { username: { $regex: regex } },
                { first_name: { $regex: regex } },
                { last_name: { $regex: regex } },
            ];
        }

        const finalQuery = Object.assign({}, statusFilter, searchQuery);

        const [items, total] = await Promise.all([
            user_model.find(finalQuery).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
            user_model.countDocuments(finalQuery)
        ]);

        const rows = items.map(u => ({
            ...u,
            created_at_ist: toISTDate(u.created_at)
        }));

        return res.json({ ok: true, rows, meta: { total, page, limit } });

    } catch (err) {
        console.error('admin users api error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * Distribute registration commission up to 7 levels.
 *
 * - bot parameter is optional. If provided, a Telegram message will be sent to inviters (best-effort).
 * - newUserDoc should be the fresh user document (with _id and username/user_id).
 * - amount is the deposit amount (number).
 */
async function distributeRegistrationCommission(bot, newUserDoc, amount, session) {
    if (!newUserDoc || !newUserDoc._id) return;
    if (!amount || amount <= 0) return;

    // Load commission rates doc (document_name: "commission_rates")
    const ratesDocQuery = other_model.findOne({ document_name: "commission_rates" });
    const ratesDoc = session ? await ratesDocQuery.session(session).lean() : await ratesDocQuery.lean();

    if (!ratesDoc) {
        // nothing to distribute if rates missing
        return;
    }

    const getRateForLevel = (n) => {
        const key = `level_${n}_rate`;
        const val = ratesDoc?.[key];
        return typeof val === "number" && !Number.isNaN(val) ? Number(val) : 0;
    };

    // Walk up the invite chain starting from the newly activated user.
    let currentInviteToId = newUserDoc._id;

    for (let level = 1; level <= 7; level++) {
        // find invite relation where invite_to_userDB_id == currentInviteToId
        const inviteRelQuery = invite_model.findOne({
            invite_to_userDB_id: currentInviteToId
        }).select("invited_by_userDB_id invite_to_userDB_id code earned_commission");

        const inviteRel = session ? await inviteRelQuery.session(session).lean() : await inviteRelQuery.lean();

        if (!inviteRel || !inviteRel.invited_by_userDB_id) break;

        const inviterId = inviteRel.invited_by_userDB_id;
        const rate = getRateForLevel(level);

        if (rate > 0) {
            const commission = Number(((amount * rate) / 100).toFixed(2));

            if (commission > 0) {
                // credit inviter wallet
                await user_model.updateOne(
                    { _id: inviterId },
                    { $inc: { wallet_balance: commission } },
                    session ? { session } : undefined
                );

                // create commission transaction
                const note = `Invite commission: Level ${level} (${rate}%) from activation`;
                await transactions_model.create([{
                    userDB_id: inviterId,
                    type: "I",
                    amount: commission,
                    status: "S",
                    note,
                    created_at: new Date()
                }], session ? { session } : undefined);

                // increment earned_commission on the invite relation (if exists)
                await invite_model.updateOne(
                    { invited_by_userDB_id: inviterId, invite_to_userDB_id: currentInviteToId },
                    { $inc: { earned_commission: commission } },
                    session ? { session } : undefined
                );

                // notify inviter via bot only if bot provided and inviter has a Telegram user_id recorded
                try {
                    if (bot && bot.telegram && inviterId) {
                        const inviterDocQuery = user_model.findById(inviterId).select("user_id first_name username wallet_balance");
                        const inviterDoc = session ? await inviterDocQuery.session(session).lean() : await inviterDocQuery.lean();

                        if (inviterDoc && inviterDoc.user_id) {
                            const freshInviterQuery = user_model.findById(inviterId).select("wallet_balance");
                            const freshInviter = session ? await freshInviterQuery.session(session).lean() : await freshInviterQuery.lean();

                            const newBalance = (freshInviter && freshInviter.wallet_balance) ? freshInviter.wallet_balance : 0;

                            const fromUserRef = newUserDoc.username ? `@${newUserDoc.username}` : (newUserDoc.user_id || String(newUserDoc._id));

                            const message = [
                                `🎉 Commission received!`,
                                ``,
                                `Amount: ₹${commission}`,
                                `Level: ${level}`,
                                `Rate: ${rate}%`,
                                `From: ${fromUserRef}`,
                                `Your updated wallet balance: ₹${newBalance}`,
                                ``,
                                `Note: Commission for user's first deposit (activation).`
                            ].join("\n");

                            await bot.telegram.sendMessage(inviterDoc.user_id, message).catch(() => { /* ignore send errors */ });
                        }
                    }
                } catch (sendErr) {
                    // swallow notification errors; distribution should continue
                    console.error("commission notification error:", sendErr);
                }
            }
        }

        // go up
        currentInviteToId = inviterId;
    }
}

/**
 * ADMIN: activate user (PENDING -> ACTIVE) + distribute commissions
 * POST /project-01/admin/users/:id/activate
 */
app.post('/project-01/admin/users/:id/activate', async (req, res) => {
    try {
        const id = req.params.id;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ ok: false, error: 'Invalid user id' });

        // --- TRANSACTION START (POST optimization) ---
        const session = await project_01_connection.startSession();
        session.startTransaction();

        try {
            const user = await user_model.findById(id).session(session).lean();
            if (!user) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ ok: false, error: 'User not found' });
            }

            const reg = (user.registration_status || '').toUpperCase();

            if (reg === 'ACTIVE') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ ok: false, error: 'User is already ACTIVE' });
            }

            if (reg !== 'PENDING') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ ok: false, error: 'User cannot be activated from current status' });
            }

            // deposit amount (fixed)
            const DEPOSIT_AMOUNT = Number(process.env.FIRST_DEPOSIT_AMOUNT) || 1000;

            // mark user active (atomic update)
            await user_model.updateOne(
                { _id: id },
                { $set: { registration_status: 'ACTIVE', activated_at: new Date() } },
                { session }
            );

            // refresh user doc
            const freshUser = await user_model.findById(id).session(session).lean();

            // distribute commission for the activation (no bot): pass null for bot if not available here
            // If you have access to your telegraf bot instance here, pass it as first arg to notify inviters.
            await distributeRegistrationCommission(project_01_bot, freshUser, DEPOSIT_AMOUNT, session);

            await session.commitTransaction();
            session.endSession();

            return res.json({ ok: true, message: 'User activated and commissions distributed' });

        } catch (txErr) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
            throw txErr;
        }
        // --- TRANSACTION END ---

    } catch (err) {
        console.error('activate user error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

module.exports = app;