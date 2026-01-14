const express = require('express')
const app = express()
const path = require('path')
const expressEjsLayouts = require('express-ejs-layouts');
const moment = require('moment-timezone');
const PER_TAP_AMOUNT = 0.5;
const DAILY_CAP = 300;
const PLAY_WINDOW_DAYS = 5;
let project_01_token = process.env.PROJECT_01_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME
const support_telegram_username = process.env.SUPPORT_TELEGRAM_USERNAME
const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");
const user_model = require("../models/user_module");
const invite_model = require("../models/invite_model");
const transactions_model = require("../models/transactions_model");
const other_model = require("../models/other_model");
const { Telegraf, Markup } = require('telegraf');
const mongoose = require("mongoose")
const { verifyCallback } = require("../helpers/watchpay");
const depositAmount = 1000;
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

function escapeRegex(s = "") {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pendingMenu() {
    return Markup.keyboard([[`💳 First Deposit ₹${depositAmount} ✅`]])
        .resize()
        .persistent();
}


function activeMenu() {
    return Markup.keyboard([
        ["🔗 Invite", "🎁 Daily Bonus"],
        ["💰 Check Balance"],
        ["🧾 Transactions Report"],
        ["💳 Add Payment Details"],
        ["👥 Team Report", "🏧 Withdraw"],
    ])
        .resize()
        .persistent();
}

async function sendMenuToChat(bot, chatId, userDoc, firstName = "") {
    const isActive = userDoc && userDoc.registration_status === "ACTIVE";

    const text = isActive
        ? (
            `Hello ${firstName || userDoc.first_name || ""}\n` +
            `Thanks for trusting our services...\n\n` +
            `Your account is already active. You can select options from the bottom menu to continue.`
        )
        : (
            `Hello ${firstName || userDoc.first_name || ""}\n` +
            `Thanks for trusting our services...\n\n` +
            `To activate your account, you need to complete a first deposit of ₹${depositAmount}. After the deposit, your ID will be activated.`
        );

    const keyboard = isActive ? activeMenu() : pendingMenu();

    // IMPORTANT: Markup.keyboard returns object with reply_markup
    await bot.telegram.sendMessage(chatId, text, {
        reply_markup: keyboard.reply_markup,
    });
}


// WatchPay deposit notify (x-www-form-urlencoded)
app.post("/project-01/watchpay/notify/deposit", express.urlencoded({ extended: false }), async (req, res) => {
    let session = null;
    try {
        const paymentKey = process.env.PROJECT_01_WATCHPAY_PAYMENT_KEY;
        if (!paymentKey) return res.status(500).send("fail");

        const body = req.body || {};

        // 1) Verify signature (callback uses signType)
        const ok = verifyCallback(body, paymentKey);
        if (!ok) return res.status(401).send("fail");

        const mchOrderNo = String(body.mchOrderNo || body.mch_order_no || "").trim();
        const tradeResult = String(body.tradeResult || "").trim(); // "1" success
        const gatewayOrderNo = String(body.orderNo || "").trim();

        if (!mchOrderNo) return res.status(400).send("fail");

        session = await project_01_connection.startSession();
        session.startTransaction();

        // 2) Find the pending deposit transaction by mch_order_no (NOT by user id)
        const tx = await transactions_model.findOne({
            gateway: "WATCHPAY",
            mch_order_no: mchOrderNo,
            type: "D",
        }).session(session);

        // If we don't find tx, still return success to stop retries (optional policy)
        if (!tx) {
            await session.commitTransaction();
            session.endSession();
            return res.send("success");
        }

        // 3) If already processed, just ack
        if (tx.status === "S") {
            await session.commitTransaction();
            session.endSession();
            return res.send("success");
        }

        // 4) Activate user + commission (only once)
        const user = await user_model.findById(tx.userDB_id).session(session);

        // 5) Update tx status
        if (tradeResult === "1") {
            tx.status = "S";
            tx.trade_result = tradeResult;
            tx.gateway_order_no = gatewayOrderNo;
            tx.raw_callback = body;
            await tx.save({ session });
            if (user && user.registration_status !== "ACTIVE") {
                user.registration_status = "ACTIVE";
                await user.save({ session });
                await distributeRegistrationCommission(project_01_bot, user, depositAmount, session);
            }
        } else {
            tx.status = "R";
            tx.trade_result = tradeResult;
            tx.raw_callback = body;
            tx.note = "Deposit failed/rejected (WatchPay)";
            await tx.save({ session });
        }

        await session.commitTransaction();
        session.endSession();
        await project_01_bot.telegram.sendMessage(user.user_id, "Payment confirmed. Your account is now active.");
        await sendMenuToChat(project_01_bot, user.user_id, user, user.first_name);
        return res.send("success");
    } catch (err) {
        console.error("watchpay notify error:", err);
        if (session) {
            try { await session.abortTransaction(); } catch (e) { }
            session.endSession();
        }
        return res.status(500).send("fail");
    }
});

// -----------------------------
// WatchPay withdraw notify (x-www-form-urlencoded)
// URL used in bot: /project-01/watchpay/notify/withdraw
// -----------------------------
app.post("/project-01/watchpay/notify/withdraw", express.urlencoded({ extended: false }), async (req, res) => {
    let session = null;
    try {
        const paymentKey = process.env.PROJECT_01_WATCHPAY_PAYMENT_KEY;
        if (!paymentKey) return res.status(500).send("fail");

        const body = req.body || {};

        // 1) Verify signature
        const ok = verifyCallback(body, paymentKey);
        if (!ok) return res.status(401).send("fail");

        // 2) Extract ids (different gateways sometimes send different key names)
        const merTransferId = String(body.merTransferId).trim();

        const tradeResult = String(body.tradeResult).trim(); // business status
        const gatewayTradeNo = String(body.tradeNo).trim();

        if (!merTransferId) return res.status(400).send("fail");

        session = await project_01_connection.startSession();
        session.startTransaction();

        // 3) Find the pending withdrawal transaction
        const tx = await transactions_model
            .findOne({
                gateway: "WATCHPAY",
                mch_order_no: merTransferId, // we stored merTransferId in mch_order_no
                type: "W",
            })
            .session(session);

        // If not found: ACK success to stop retries (same approach used in deposit notifier)
        if (!tx) {
            await session.commitTransaction();
            session.endSession();
            return res.send("success");
        }

        // If already processed: ACK
        if (tx.status === "S" || tx.status === "R") {
            await session.commitTransaction();
            session.endSession();
            return res.send("success");
        }

        // Load user for messages/refund
        const user = await user_model.findById(tx.userDB_id).session(session);

        // 4) Interpret tradeResult:
        // Commonly:
        //   "1" => success
        //   "0" => processing/pending (do not finalize)
        //   other => fail
        const isSuccess = tradeResult === "1";
        const isProcessing = tradeResult === "0";

        // Always store callback payload
        tx.trade_result = tradeResult;
        tx.gateway_order_no = gatewayTradeNo || tx.gateway_order_no;
        tx.raw_callback = body;

        if (isSuccess) {
            tx.status = "S";
            tx.note = tx.note || "Withdraw success (WatchPay)";
            tx.processed_at = new Date();
            await tx.save({ session });

            await session.commitTransaction();
            session.endSession();
            session = null;

            // Notify user
            if (project_01_bot && user?.user_id) {
                project_01_bot.telegram
                    .sendMessage(
                        user.user_id,
                        `✅ Withdrawal Successful\nTX id: ${tx._id}\nAmount: ₹${Number(tx.amount || 0).toFixed(
                            2
                        )}`
                    )
                    .catch(() => { });
            }

            return res.send("success");
        }

        if (isProcessing) {
            // keep as Pending, just update raw_callback / gateway_order_no / trade_result
            await tx.save({ session });

            await session.commitTransaction();
            session.endSession();
            session = null;

            return res.send("success");
        }

        // 5) Fail => mark rejected + refund wallet (since wallet was deducted at request time)
        const refundAmount = Number(tx.amount || 0);

        tx.status = "R";
        tx.note = `Withdraw rejected/failed`;
        tx.processed_at = new Date();
        await tx.save({ session });

        if (user && refundAmount > 0) {
            await user_model.updateOne(
                { _id: user._id },
                { $inc: { wallet_balance: refundAmount } },
                { session }
            );
        }

        await session.commitTransaction();
        session.endSession();
        session = null;

        // Notify user
        if (project_01_bot && user?.user_id) {
            project_01_bot.telegram
                .sendMessage(
                    user.user_id,
                    `❌ Withdrawal Failed\nTX id: ${tx._id}\nAmount refunded: ₹${refundAmount.toFixed(2)}`
                )
                .catch(() => { });
        }

        return res.send("success");
    } catch (err) {
        console.error("watchpay withdraw notify error:", err);

        if (session) {
            try {
                await session.abortTransaction();
            } catch (_) { }
            session.endSession();
        }
        return res.status(500).send("fail");
    }
}
);

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
        support_telegram_username,
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
        _id: String(t._id),
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

async function getFirstSuccessDepositTx(userDB_id) {
    return transactions_model
        .findOne({ userDB_id, type: "D", status: "S" })
        .select("created_at")
        .sort({ created_at: 1 })
        .lean();
}

/**
 * GET /project-01/daily-bonus
 * Renders EJS page (tap_tap_game) using baseTemplateData
 */
app.get('/project-01/daily-bonus', async (req, res) => {
    try {
        const { userDB_id } = req.query;
        if (!userDB_id) {
            return res.render('pages/tap_tap_game', baseTemplateData({
                page_name: "Daily Bonus",
                error: "userDB_id required"
            }));
        }

        const user = await user_model.findById(userDB_id).lean();
        if (!user) {
            return res.render('pages/tap_tap_game', baseTemplateData({
                page_name: "Daily Bonus",
                error: "User not found"
            }));
        }

        // only ACTIVE users should play (your activation is tied to success deposit flow)
        if (user.registration_status !== "ACTIVE") {
            return res.render('pages/tap_tap_game', baseTemplateData({
                page_name: "Daily Bonus",
                user,
                error: "Your account is not active yet. Please complete first deposit."
            }));
        }

        const depTx = await getFirstSuccessDepositTx(user._id);
        if (!depTx?.created_at) {
            return res.render('pages/tap_tap_game', baseTemplateData({
                page_name: "Daily Bonus",
                user,
                error: "Activation deposit not found."
            }));
        }

        const startedAt = depTx.created_at;
        const endsAt = moment(startedAt).add(PLAY_WINDOW_DAYS, "days");
        const withinPlayWindow = moment().isBefore(endsAt);

        const tab = (user.tab_tab_game && typeof user.tab_tab_game === 'object')
            ? user.tab_tab_game
            : { balance: 0, count: 0, auto_credited_flag: false };

        // if already reached daily cap but flag not set, just lock for today (NO wallet credit here)
        if (Number(tab.balance || 0) >= DAILY_CAP && !tab.auto_credited_flag) {
            await user_model.updateOne(
                { _id: user._id },
                { $set: { "tab_tab_game.auto_credited_flag": true } }
            );
            tab.auto_credited_flag = true;
        }

        return res.render('pages/tap_tap_game', baseTemplateData({
            page_name: "Daily Bonus",
            user,
            withdrawable_balance: Number(user.wallet_balance || 0),
            tab_count: Number(tab.count || 0),
            tab_balance: Number(tab.balance || 0),
            per_tap_amount: PER_TAP_AMOUNT,

            // new eligibility flags for UI
            eligible_for_play: withinPlayWindow,
            play_window_days: PLAY_WINDOW_DAYS,
            play_window_ends_at: endsAt.toDate(),
            daily_cap: DAILY_CAP,
        }));
    } catch (err) {
        console.error("daily-bonus GET error:", err);
        return res.render('pages/tap_tap_game', baseTemplateData({
            page_name: "Daily Bonus",
            error: "Server error"
        }));
    }
});

// helper (same file)
function isWriteConflict(err) {
    const code = err?.code;
    const codeName = err?.codeName;
    const labels = err?.errorLabelSet ? Array.from(err.errorLabelSet) : (err?.errorLabels || []);
    return code === 112 || codeName === "WriteConflict" || labels.includes("TransientTransactionError");
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

app.post('/project-01/daily-bonus/tap', async (req, res) => {
    try {
        const { userDB_id } = req.body;
        if (!userDB_id) return res.status(400).json({ error: "userDB_id required" });

        // (your existing checks: user exists, ACTIVE, play window based on first success deposit)
        // ... keep same as you already implemented

        const MAX_RETRIES = 6;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const updated = await user_model.findOneAndUpdate(
                    {
                        _id: userDB_id,
                        $or: [
                            { "tab_tab_game.auto_credited_flag": { $exists: false } },
                            { "tab_tab_game.auto_credited_flag": { $ne: true } }
                        ],
                        $expr: { $lt: [{ $ifNull: ["$tab_tab_game.balance", 0] }, DAILY_CAP] }
                    },
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

                                // wallet instantly inc
                                "wallet_balance": { $add: [{ $ifNull: ["$wallet_balance", 0] }, PER_TAP_AMOUNT] },

                                // lock once daily cap reached (for today)
                                "tab_tab_game.auto_credited_flag": {
                                    $cond: [
                                        {
                                            $gte: [
                                                {
                                                    $min: [
                                                        { $add: [{ $ifNull: ["$tab_tab_game.balance", 0] }, PER_TAP_AMOUNT] },
                                                        DAILY_CAP
                                                    ]
                                                },
                                                DAILY_CAP
                                            ]
                                        },
                                        true,
                                        { $ifNull: ["$tab_tab_game.auto_credited_flag", false] }
                                    ]
                                }
                            }
                        }
                    ],
                    { new: true }
                ).lean();

                if (!updated) {
                    return res.status(403).json({ error: "Daily limit reached for today." });
                }

                const tab = updated.tab_tab_game || {};
                return res.json({
                    tab_count: Number(tab.count || 0),
                    tab_balance: Number(tab.balance || 0),
                    withdrawable_balance: Number(updated.wallet_balance || 0),
                    auto_credited_flag: Boolean(tab.auto_credited_flag)
                });

            } catch (err) {
                if (isWriteConflict(err) && attempt < MAX_RETRIES) {
                    await sleep(15 * attempt); // small backoff
                    continue;
                }
                throw err;
            }
        }

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
 * computeSummary() - deposits are derived from ACTIVE users * fixed deposit (depositAmount)
 */
async function computeSummary() {
    const DEPOSIT_PER_USER = depositAmount;

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
app.get("/project-01/admin/withdrawals", async (req, res) => {
    try {
        const statusMap = { All: null, Pending: "P", Reject: "R", Success: "S" };
        const statusParam = req.query.status || "Pending";
        const statusFilter = statusMap[statusParam] ? { status: statusMap[statusParam] } : {};

        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.max(10, Math.min(200, parseInt(req.query.limit || "50", 10)));
        const skip = (page - 1) * limit;

        const search = String(req.query.search || "").trim();

        // base query: withdrawals
        const query = { type: "W", ...statusFilter };

        // search support: Order Id (mch_order_no), gateway_order_no, note/UPI, txid, user fields
        if (search) {
            const or = [];
            const rx = new RegExp(escapeRegex(search), "i");

            // txid direct
            if (mongoose.Types.ObjectId.isValid(search)) {
                or.push({ _id: new mongoose.Types.ObjectId(search) });
            }

            // order id / gateway order / note
            or.push({ mch_order_no: rx });
            or.push({ gateway_order_no: rx });
            or.push({ note: rx });

            // user side search
            const userOr = [];
            userOr.push({ username: rx });
            userOr.push({ first_name: rx });
            userOr.push({ last_name: rx });

            // numeric telegram user_id search
            const maybeNum = Number(search);
            if (Number.isFinite(maybeNum)) userOr.push({ user_id: maybeNum });

            const matchedUsers = await user_model
                .find(userOr.length ? { $or: userOr } : {})
                .select("_id")
                .limit(2000)
                .lean();

            if (matchedUsers && matchedUsers.length) {
                const ids = matchedUsers.map((u) => u._id);
                or.push({ userDB_id: { $in: ids } });
            }

            query.$or = or;
        }

        const [items, total] = await Promise.all([
            transactions_model.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
            transactions_model.countDocuments(query),
        ]);

        // attach user info (same as your existing logic)
        const userIds = [...new Set(items.map((it) => String(it.userDB_id)).filter(Boolean))];
        let usersMap = {};
        if (userIds.length) {
            const users = await user_model
                .find({ _id: { $in: userIds } })
                .select("first_name last_name username user_id wallet_balance registration_status created_at bank_details")
                .lean();

            usersMap = users.reduce((acc, u) => {
                acc[String(u._id)] = u;
                return acc;
            }, {});
        }

        const rows = items.map((it) => {
            const u = usersMap[String(it.userDB_id)] || null;
            return {
                ...it,
                id: String(it._id),
                created_at_ist: it.created_at ? toISTDateTime(it.created_at) : null,
                user: u
                    ? {
                        id: String(u._id),
                        firstname: u.first_name,
                        lastname: u.last_name,
                        username: u.username,
                        userid: u.user_id,
                        walletbalance: u.wallet_balance,
                        registrationstatus: u.registration_status,
                        createdatist: u.created_at ? toISTDate(u.created_at) : null,
                        bank_details: u.bank_details,
                    }
                    : null,
            };
        });
        return res.json({ ok: true, rows, meta: { total, page, limit } });
    } catch (err) {
        console.error("admin withdrawals api error:", err);
        return res.status(500).json({ ok: false, error: "Server error" });
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
                { $set: { status: 'S', processed_at: new Date() } },
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

// ==============================
// DEPOSIT MANAGEMENT ENDPOINTS
// ==============================

/**
 * GET deposits list
 * GET /project-01/admin/deposits?status=Pending&page=1&limit=50&search=
 */
app.get("/project-01/admin/deposits", async (req, res) => {
    try {
        const statusMap = { All: null, Pending: "P", Success: "S", Reject: "R" };
        const statusParam = req.query.status || "Pending";
        const statusFilter = statusMap[statusParam] ? { status: statusMap[statusParam] } : {};

        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.max(10, Math.min(200, parseInt(req.query.limit || "50", 10)));
        const skip = (page - 1) * limit;

        const search = String(req.query.search || "").trim();

        // base query: deposits (type "D")
        const query = { type: "D", ...statusFilter };

        // search support: Order Id (mch_order_no), gateway_order_no, note, user fields
        if (search) {
            const or = [];
            const rx = new RegExp(escapeRegex(search), "i");

            // txid direct
            if (mongoose.Types.ObjectId.isValid(search)) {
                or.push({ _id: new mongoose.Types.ObjectId(search) });
            }

            // order id / gateway order / note
            or.push({ mch_order_no: rx });
            or.push({ gateway_order_no: rx });
            or.push({ note: rx });

            // user side search
            const userOr = [];
            userOr.push({ username: rx });
            userOr.push({ first_name: rx });
            userOr.push({ last_name: rx });

            // numeric telegram user_id search
            const maybeNum = Number(search);
            if (Number.isFinite(maybeNum)) userOr.push({ user_id: maybeNum });

            const matchedUsers = await user_model
                .find(userOr.length ? { $or: userOr } : {})
                .select("_id")
                .limit(2000)
                .lean();

            if (matchedUsers && matchedUsers.length) {
                const ids = matchedUsers.map((u) => u._id);
                or.push({ userDB_id: { $in: ids } });
            }

            query.$or = or;
        }

        const [items, total] = await Promise.all([
            transactions_model.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
            transactions_model.countDocuments(query),
        ]);

        // attach user info
        const userIds = [...new Set(items.map((it) => String(it.userDB_id)).filter(Boolean))];
        let usersMap = {};
        if (userIds.length) {
            const users = await user_model
                .find({ _id: { $in: userIds } })
                .select("first_name last_name username user_id wallet_balance registration_status created_at")
                .lean();

            usersMap = users.reduce((acc, u) => {
                acc[String(u._id)] = u;
                return acc;
            }, {});
        }

        const rows = items.map((it) => {
            const u = usersMap[String(it.userDB_id)] || null;
            return {
                ...it,
                id: String(it._id),
                created_at_ist: it.created_at ? toISTDateTime(it.created_at) : null,
                user: u
                    ? {
                        id: String(u._id),
                        firstname: u.first_name,
                        lastname: u.last_name,
                        username: u.username,
                        userid: u.user_id,
                        walletbalance: u.wallet_balance,
                        registrationstatus: u.registration_status,
                        createdatist: u.created_at ? toISTDate(u.created_at) : null,
                    }
                    : null,
            };
        });

        return res.json({ ok: true, rows, meta: { total, page, limit } });
    } catch (err) {
        console.error("admin deposits api error:", err);
        return res.status(500).json({ ok: false, error: "Server error" });
    }
});

/**
 * Approve deposit
 * POST /project-01/admin/deposits/:txid/approve
 */
app.post('/project-01/admin/deposits/:txid/approve', async (req, res) => {
    let session = null;
    try {
        const { txid } = req.params;

        if (!txid || !mongoose.Types.ObjectId.isValid(txid)) {
            return res.status(400).json({ ok: false, error: 'Invalid transaction ID' });
        }

        session = await project_01_connection.startSession();
        session.startTransaction();

        try {
            // Find the deposit transaction
            const tx = await transactions_model.findById(txid).session(session).lean();
            if (!tx || tx.type !== 'D') {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ ok: false, error: 'Deposit transaction not found' });
            }

            if (tx.status !== 'P') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: `Deposit is not in Pending status. Current status: ${tx.status}`
                });
            }

            // Get the user
            const user = await user_model.findById(tx.userDB_id).session(session).lean();
            if (!user) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ ok: false, error: 'User not found' });
            }

            // Update transaction status to Success
            await transactions_model.updateOne(
                { _id: txid },
                {
                    $set: {
                        status: 'S',
                        note: 'Deposit approved by admin',
                        processed_at: new Date()
                    }
                },
                { session }
            );

            // Update user wallet balance
            await user_model.updateOne(
                { _id: user._id },
                { $inc: { wallet_balance: 0 } },
                { session }
            );

            // If user is not active, activate them and distribute commission
            if (user.registration_status !== 'ACTIVE') {
                await user_model.updateOne(
                    { _id: user._id },
                    { $set: { registration_status: 'ACTIVE', activated_at: new Date() } },
                    { session }
                );

                // Distribute commission for the activation
                await distributeRegistrationCommission(project_01_bot, user, tx.amount, session);
            }

            await session.commitTransaction();
            session.endSession();

            // Send notification to user if bot is available
            if (project_01_bot && user.user_id) {
                try {
                    const message = `✅ Your deposit of ₹${tx.amount} has been approved!\n\n` +
                        `Your account is now active and ₹${tx.amount} has been added to your wallet.\n` +
                        `Wallet Balance: ₹${user.wallet_balance + tx.amount}`;

                    await project_01_bot.telegram.sendMessage(user.user_id, message);
                } catch (notifyErr) {
                    console.error("Failed to send deposit approval notification:", notifyErr);
                }
            }

            return res.json({
                ok: true,
                message: 'Deposit approved successfully',
                data: {
                    amount: tx.amount,
                    user_id: user.user_id,
                    registration_activated: user.registration_status !== 'ACTIVE'
                }
            });

        } catch (txErr) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
            throw txErr;
        }

    } catch (err) {
        console.error('approve deposit error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * Reject deposit
 * POST /project-01/admin/deposits/:txid/reject
 */
app.post('/project-01/admin/deposits/:txid/reject', async (req, res) => {
    let session = null;
    try {
        const { txid } = req.params;
        const { reason } = req.body;

        if (!txid || !mongoose.Types.ObjectId.isValid(txid)) {
            return res.status(400).json({ ok: false, error: 'Invalid transaction ID' });
        }

        session = await project_01_connection.startSession();
        session.startTransaction();

        try {
            const tx = await transactions_model.findById(txid).session(session).lean();
            if (!tx || tx.type !== 'D') {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).json({ ok: false, error: 'Deposit transaction not found' });
            }

            if (tx.status !== 'P') {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({
                    ok: false,
                    error: `Deposit is not in Pending status. Current status: ${tx.status}`
                });
            }

            // Get the user for notification
            const user = await user_model.findById(tx.userDB_id).session(session).lean();

            // Update transaction status to Rejected
            const rejectNote = reason ? `Deposit rejected by admin: ${reason}` : 'Deposit rejected by admin';
            await transactions_model.updateOne(
                { _id: txid },
                {
                    $set: {
                        status: 'R',
                        note: rejectNote,
                        processed_at: new Date()
                    }
                },
                { session }
            );

            await session.commitTransaction();
            session.endSession();

            // Send notification to user if bot is available
            if (project_01_bot && user && user.user_id) {
                try {
                    const message = `❌ Your deposit of ₹${tx.amount} has been rejected.\n\n` +
                        `Reason: ${reason || 'No reason provided'}\n` +
                        `Please contact support if you have any questions.`;

                    await project_01_bot.telegram.sendMessage(user.user_id, message);
                } catch (notifyErr) {
                    console.error("Failed to send deposit rejection notification:", notifyErr);
                }
            }

            return res.json({
                ok: true,
                message: 'Deposit rejected successfully',
                data: {
                    amount: tx.amount,
                    user_id: user ? user.user_id : null,
                    reason: reason || null
                }
            });

        } catch (txErr) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
            throw txErr;
        }

    } catch (err) {
        console.error('reject deposit error:', err);
        return res.status(500).json({ ok: false, error: 'Server error' });
    }
});

/**
 * GET users list (search + filter + pagination)
 * GET /project-01/admin/users?status=All&page=1&limit=30&search=
 *
 * status => All | Pending | Active (filters by registration_status)
 */
app.get("/project-01/admin/users", async (req, res) => {
    try {
        const statusParam = req.query.status || "All";

        const statusFilter =
            statusParam === "All"
                ? {}
                : statusParam === "Pending"
                    ? { registration_status: "PENDING" }
                    : statusParam === "Active"
                        ? { registration_status: "ACTIVE" }
                        : { registration_status: statusParam };

        const page = Math.max(1, parseInt(req.query.page || "1", 10));
        const limit = Math.max(10, Math.min(200, parseInt(req.query.limit || "30", 10)));
        const skip = (page - 1) * limit;

        const search = String(req.query.search || "").trim();
        const searchQuery = {};

        if (search) {
            const rx = new RegExp(escapeRegex(search), "i");
            const ors = [
                { username: rx },
                { first_name: rx },
                { last_name: rx },
            ];

            const maybeNum = Number(search);
            if (Number.isFinite(maybeNum)) ors.push({ user_id: maybeNum });

            searchQuery.$or = ors;
        }

        const finalQuery = { ...statusFilter, ...searchQuery };

        const [total, items] = await Promise.all([
            user_model.countDocuments(finalQuery),
            (async () => {
                const TX_COLL = transactions_model.collection.name; // usually "transactions"
                const INV_COLL = invite_model.collection.name;      // usually "invites"

                const pipeline = [
                    { $match: finalQuery },
                    { $sort: { created_at: -1 } },
                    { $skip: skip },
                    { $limit: limit },

                    // total income = sum of Invite commission transactions (type "I")
                    {
                        $lookup: {
                            from: TX_COLL,
                            let: { uid: "$_id" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $and: [
                                                { $eq: ["$userDB_id", "$$uid"] },
                                                { $eq: ["$type", "I"] },
                                            ],
                                        },
                                    },
                                },
                                { $group: { _id: null, total: { $sum: "$amount" } } },
                            ],
                            as: "incomeAgg",
                        },
                    },
                    {
                        $addFields: {
                            total_income: { $ifNull: [{ $arrayElemAt: ["$incomeAgg.total", 0] }, 0] },
                        },
                    },

                    // team count (downline size) via graph lookup on Invite edges
                    {
                        $graphLookup: {
                            from: INV_COLL,
                            startWith: "$_id",
                            connectFromField: "invite_to_userDB_id",
                            connectToField: "invited_by_userDB_id",
                            as: "downlineEdges",
                            maxDepth: 6, // upto 7 levels total (0..6)
                        },
                    },
                    { $addFields: { team_count: { $size: "$downlineEdges" } } },

                    { $project: { incomeAgg: 0, downlineEdges: 0 } },
                ];

                return user_model.aggregate(pipeline);
            })(),
        ]);

        const rows = (items || []).map((u) => ({
            id: String(u._id),
            firstname: u.first_name,
            lastname: u.last_name,
            username: u.username,
            userid: u.user_id,
            walletbalance: u.wallet_balance,
            registrationstatus: u.registration_status,
            invitecode: u.invite_code,
            createdatist: u.created_at ? toISTDate(u.created_at) : null,

            // NEW fields for UI
            teamcount: Number(u.team_count || 0),
            totalincome: Number(u.total_income || 0),
        }));

        return res.json({ ok: true, rows, meta: { total, page, limit } });
    } catch (err) {
        console.error("admin users api error:", err);
        return res.status(500).json({ ok: false, error: "Server error" });
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
            const DEPOSIT_AMOUNT = depositAmount;

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

/**
 * Delete user (admin)
 * POST /project-01/admin/users/:id/delete
 */
// app.post("/project-01/admin/users/:id/delete", async (req, res) => {
//     let session = null;
//     try {
//         const { id } = req.params;

//         if (!id || !mongoose.Types.ObjectId.isValid(id)) {
//             return res.status(400).json({ ok: false, error: "Invalid user id" });
//         }

//         session = await project_01_connection.startSession();
//         session.startTransaction();

//         const user = await user_model.findById(id).session(session).lean();
//         if (!user) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(404).json({ ok: false, error: "User not found" });
//         }

//         // Delete related data (safe cleanup)
//         await Promise.all([
//             user_model.deleteOne({ _id: user._id }, { session }),
//             transactions_model.deleteMany({ userDB_id: user._id }, { session }),
//             invite_model.deleteMany(
//                 {
//                     $or: [
//                         { invited_by_userDB_id: user._id },
//                         { invite_to_userDB_id: user._id },
//                     ],
//                 },
//                 { session }
//             ),
//         ]);

//         await session.commitTransaction();
//         session.endSession();

//         return res.json({ ok: true, message: "User deleted successfully" });
//     } catch (err) {
//         console.error("admin delete user error:", err);
//         if (session) {
//             try { await session.abortTransaction(); } catch (_) { }
//             session.endSession();
//         }
//         return res.status(500).json({ ok: false, error: "Server error" });
//     }
// });

app.post("/project-01/admin/users/:id/delete", async (req, res) => {
    let session = null;
    try {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ ok: false, error: "Invalid user id" });
        }

        session = await project_01_connection.startSession();
        session.startTransaction();

        const user = await user_model.findById(id).session(session).lean();
        if (!user) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ ok: false, error: "User not found" });
        }

        // 1) Delete user + his transactions
        await Promise.all([
            user_model.deleteOne({ _id: user._id }, { session }),
            transactions_model.deleteMany({ userDB_id: user._id }, { session }),

            // 2) If user is inviter => delete those invite docs
            invite_model.deleteMany({ invited_by_userDB_id: user._id }, { session }),

            // 3) If user is invitee => do NOT delete doc, only remove invite_to_userDB_id field
            invite_model.updateMany(
                { invite_to_userDB_id: user._id },
                { $unset: { invite_to_userDB_id: "" } },
                { session }
            ),
        ]);

        await session.commitTransaction();
        session.endSession();

        return res.json({ ok: true, message: "User deleted successfully" });
    } catch (err) {
        console.error("admin delete user error:", err);
        if (session) {
            try { await session.abortTransaction(); } catch (_) { }
            session.endSession();
        }
        return res.status(500).json({ ok: false, error: "Server error" });
    }
});


module.exports = app;