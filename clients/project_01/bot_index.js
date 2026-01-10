// clients/project_01/bot_index.js

const crypto = require("crypto");
const axios = require("axios");
const { Markup } = require("telegraf");

const { project_01_connection } = require("../../globle_helper/mongoDB_connection");

const user_model = require("./models/user_module");
const invite_model = require("./models/invite_model");
const transactions_model = require("./models/transactions_model");

const encode_payload = require("./helpers/encode_payload");
const { createDepositOrder, createWithdrawOrder } = require("./helpers/watchpay");
const { startCron } = require("./helpers/cron");

const depositAmount = 1000;

startCron()

// ==============================
// CONFIG
// ==============================
const MIN_WITHDRAW_AMOUNT = 1000;

// ------------------------------
// In-memory user flow state
// ------------------------------
const userState = new Map(); // telegram_user_id -> { step, data }

function setState(tgUserId, step, data = {}) {
    userState.set(tgUserId, { step, data });
}
function getState(tgUserId) {
    return userState.get(tgUserId) || { step: null, data: {} };
}
function clearState(tgUserId) {
    userState.delete(tgUserId);
}

function normalizeStr(s) {
    return (s || "").toString().trim();
}

function parseAmount(text) {
    const n = Number(String(text || "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.floor(n * 100) / 100;
}

// ------------------------------
// Banks list (buttons)
// ------------------------------
const BANKS = [
    { code: "IDPT0001", name: "Canara Bank" },
    { code: "IDPT0002", name: "DCB Bank" },
    { code: "IDPT0003", name: "Federal Bank" },
    { code: "IDPT0004", name: "HDFC Bank" },
    { code: "IDPT0005", name: "Punjab National Bank" },
    { code: "IDPT0006", name: "Indian Bank" },
    { code: "IDPT0007", name: "ICICI Bank" },
    { code: "IDPT0008", name: "Syndicate Bank" },
    { code: "IDPT0009", name: "Karur Vysya Bank" },
    { code: "IDPT0010", name: "Union Bank of India" },
    { code: "IDPT0011", name: "Kotak Mahindra Bank" },
    { code: "IDPT0012", name: "IDFC First Bank" },
    { code: "IDPT0013", name: "Andhra Bank" },
    { code: "IDPT0014", name: "Karnataka Bank" },
    { code: "IDPT0015", name: "icici corporate bank" },
    { code: "IDPT0016", name: "Axis Bank" },
    { code: "IDPT0017", name: "UCO Bank" },
    { code: "IDPT0018", name: "South Indian Bank" },
    { code: "IDPT0019", name: "Yes Bank" },
    { code: "IDPT0020", name: "Standard Chartered Bank" },
    { code: "IDPT0021", name: "State Bank of India" },
    { code: "IDPT0022", name: "Indian Overseas Bank" },
    { code: "IDPT0023", name: "Bandhan Bank" },
    { code: "IDPT0024", name: "Central Bank of India" },
    { code: "IDPT0025", name: "Bank of Baroda" },
];

// IFSC prefix mapping (for example + strict check)
const IFSC_PREFIX_BY_BANK_CODE = {
    IDPT0001: "CNRB",
    IDPT0002: "DCBL",
    IDPT0003: "FDRL",
    IDPT0004: "HDFC",
    IDPT0005: "PUNB",
    IDPT0006: "IDIB",
    IDPT0007: "ICIC",
    IDPT0008: "SYNB",
    IDPT0009: "KVBL",
    IDPT0010: "UBIN",
    IDPT0011: "KKBK",
    IDPT0012: "IDFB",
    IDPT0013: "ANDB",
    IDPT0014: "KARB",
    IDPT0015: "ICIC",
    IDPT0016: "UTIB",
    IDPT0017: "UCBA",
    IDPT0018: "SIBL",
    IDPT0019: "YESB",
    IDPT0020: "SCBL",
    IDPT0021: "SBIN",
    IDPT0022: "IOBA",
    IDPT0023: "BDBL",
    IDPT0024: "CBIN",
    IDPT0025: "BARB",
};

function getIfscPrefix(bank_code) {
    return IFSC_PREFIX_BY_BANK_CODE[String(bank_code || "").trim()] || "";
}
function getIfscExample(bank_code) {
    const p = getIfscPrefix(bank_code);
    return p ? `${p}0XXXXXX` : `ABCD0XXXXXX`;
}
function isValidIfscStructure(ifsc) {
    const s = String(ifsc || "").trim().toUpperCase();
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s);
}
function isValidAccountNumber(acc) {
    const s = String(acc || "").trim();
    return /^[0-9]{6,20}$/.test(s);
}
function safeMaskAccount(acc) {
    const s = String(acc || "").trim();
    if (!s) return "-";
    if (s.length <= 4) return s;
    return `${"*".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`;
}

function bankKeyboard() {
    const rows = [];
    for (let i = 0; i < BANKS.length; i += 2) {
        const row = [];
        const a = BANKS[i];
        row.push(Markup.button.callback(a.name, `P01_BANK_PICK|${a.code}`));
        const b = BANKS[i + 1];
        if (b) row.push(Markup.button.callback(b.name, `P01_BANK_PICK|${b.code}`));
        rows.push(row);
    }
    rows.push([Markup.button.callback("Cancel", "P01_BANK_CANCEL")]);
    return Markup.inlineKeyboard(rows);
}

function getBankDetails(userDoc) {
    return (userDoc && userDoc.bank_details) || {};
}
function hasBankDetails(userDoc) {
    const b = getBankDetails(userDoc);
    return !!(b.holder_name && b.bank_code && b.bank_name && b.account_number && b.ifsc);
}

// ------------------------------
// Invite code generator
// ------------------------------
async function generateUniqueInviteCode(maxAttempts = 200) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const code = crypto.randomBytes(4).toString("hex");
        const exists = await user_model.findOne({ invite_code: code }).select("_id").lean();
        if (!exists) return code;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
        const code = crypto.randomBytes(6).toString("hex");
        const exists = await user_model.findOne({ invite_code: code }).select("_id").lean();
        if (!exists) return code;
    }
    throw new Error("Failed to generate unique invite code after many attempts");
}

// ------------------------------
// UI text + menus
// ------------------------------
function introText(first_name, is_active) {
    if (is_active) {
        return (
            `Hello ${first_name}\n` +
            `Thanks for trusting our services.\n\n` +
            `Your account is already active. You can select options from the bottom menu to continue.`
        );
    }
    return (
        `Hello ${first_name}\n` +
        `Thanks for trusting our services.\n\n` +
        `To activate your account, you need to complete a first deposit of ₹${depositAmount}. After the deposit, your ID will be activated.`
    );
}

function pendingMenu() {
    return Markup.keyboard([[`💳 First Deposit ₹${depositAmount} ✅`]]).resize().persistent();
}

function activeMenu() {
    return Markup.keyboard(
        [
            ["🔗 Invite", "🎁 Daily Bonus"],
            ["💰 Check Balance"],
            ["🧾 Transactions Report"],
            ["🏦 Add/Update Bank Details"],
            ["👥 Team Report", "🏧 Withdraw"],
        ],
    )
        .resize()
        .persistent();
}

async function sendMenu(ctx, userDoc) {
    const tg = ctx.from;
    if (!userDoc || userDoc.registration_status !== "ACTIVE") {
        return ctx.reply(introText(tg?.first_name, false), pendingMenu());
    }
    return ctx.reply(introText(tg?.first_name, true), activeMenu());
}

function getInviteBotLink(inviteCode) {
    const botUsername = process.env.BOT_USERNAME_PROJECT_01;
    return `https://t.me/${botUsername}?start=${encodeURIComponent(inviteCode)}`;
}

function getMiniAppLink(type, userDB_id) {
    const payload = `project-01:${type}:${userDB_id}`;
    return `https://t.me/${process.env.BOT_USERNAME_PROJECT_01}/${process.env.MINI_APP_NAME_PROJECT_01}?startapp=${encode_payload(
        payload,
    )}`;
}

// ------------------------------
// User upsert + referral handling
// ------------------------------
async function upsertUserFromCtx(ctx, session = null) {
    const tg = ctx.from;
    const telegramUserId = tg?.id;

    let ownSession = false;
    if (!session) {
        session = await project_01_connection.startSession();
        session.startTransaction();
        ownSession = true;
    }

    try {
        let user = await user_model.findOne({ user_id: telegramUserId }).session(session);

        if (!user) {
            const invite_code = await generateUniqueInviteCode();
            const created = await user_model.create(
                [
                    {
                        user_id: telegramUserId,
                        first_name: normalizeStr(tg.first_name),
                        last_name: normalizeStr(tg.last_name),
                        username: normalizeStr(tg.username),
                        allows_write_to_pm: Boolean(tg.allows_write_to_pm),
                        invite_code,
                        registration_status: "PENDING",
                        wallet_balance: 0,
                        created_at: new Date(),
                    },
                ],
                { session },
            );
            user = created && created[0] ? created[0] : null;

            let safetyAttempts = 0;
            while (safetyAttempts < 20) {
                const conflict = await user_model
                    .findOne({ invite_code: user.invite_code, _id: { $ne: user._id } })
                    .select("_id")
                    .session(session)
                    .lean();

                if (!conflict) break;

                const newCode = await generateUniqueInviteCode();
                await user_model.updateOne({ _id: user._id }, { $set: { invite_code: newCode } }, { session });
                user = await user_model.findById(user._id).session(session);
                safetyAttempts++;
            }
        } else {
            await user_model.updateOne(
                { _id: user._id },
                {
                    $set: {
                        first_name: normalizeStr(tg.first_name),
                        last_name: normalizeStr(tg.last_name),
                        username: normalizeStr(tg.username),
                        allows_write_to_pm: Boolean(tg.allows_write_to_pm),
                    },
                },
                { session },
            );

            user = await user_model.findById(user._id).session(session);

            if (!user.invite_code) {
                const invite_code = await generateUniqueInviteCode();
                await user_model.updateOne({ _id: user._id }, { $set: { invite_code } }, { session });
                user = await user_model.findById(user._id).session(session);
            }
        }

        if (ownSession) {
            await session.commitTransaction();
            session.endSession();
        }
        return user;
    } catch (err) {
        if (ownSession) {
            try {
                await session.abortTransaction();
            } catch (_) { }
            session.endSession();
        }
        throw err;
    }
}

async function handleStartPayload(payload, newUserDoc, session = null) {
    const code = (payload || "").trim();
    if (!code) return;
    if (!newUserDoc) return;
    if (code === newUserDoc.invite_code) return;

    let ownSession = false;
    if (!session) {
        session = await project_01_connection.startSession();
        session.startTransaction();
        ownSession = true;
    }

    try {
        const inviter = await user_model.findOne({ invite_code: code }).select("_id").session(session).lean();
        if (!inviter) {
            if (ownSession) {
                await session.commitTransaction();
                session.endSession();
            }
            return;
        }

        const exists = await invite_model
            .findOne({ invited_by_userDB_id: inviter._id, invite_to_userDB_id: newUserDoc._id })
            .session(session)
            .lean();

        if (!exists) {
            await invite_model.create(
                [
                    {
                        code,
                        invited_by_userDB_id: inviter._id,
                        invite_to_userDB_id: newUserDoc._id,
                        earned_commission: 0,
                        created_at: new Date(),
                    },
                ],
                { session },
            );
        }

        if (ownSession) {
            await session.commitTransaction();
            session.endSession();
        }
    } catch (err) {
        if (ownSession) {
            try {
                await session.abortTransaction();
            } catch (_) { }
            session.endSession();
        }
        throw err;
    }
}

// ------------------------------
// Steps
// ------------------------------
const STEPS = {
    CONFIRM_BANK_UPDATE: "CONFIRM_BANK_UPDATE",
    WAIT_BANK_HOLDER: "WAIT_BANK_HOLDER",
    WAIT_BANK_PICK: "WAIT_BANK_PICK",
    WAIT_BANK_ACCOUNT: "WAIT_BANK_ACCOUNT",
    WAIT_BANK_IFSC: "WAIT_BANK_IFSC",

    WAIT_WITHDRAW_AMOUNT: "WAIT_WITHDRAW_AMOUNT",
    WITHDRAW_CONFIRM: "WITHDRAW_CONFIRM",
};

module.exports = (bot) => {
    // /start
    bot.start(async (ctx) => {
        let session = null;
        try {
            clearState(ctx.from.id);

            session = await project_01_connection.startSession();
            session.startTransaction();

            const user = await upsertUserFromCtx(ctx, session);
            const payload = ctx.startPayload || ctx.message?.text?.split(" ")?.slice(1)?.join(" ") || "";
            await handleStartPayload(payload, user, session);

            await session.commitTransaction();
            session.endSession();
            session = null;

            await sendMenu(ctx, user);
        } catch (err) {
            console.error("start error:", err);
            if (session) {
                try {
                    await session.abortTransaction();
                } catch (_) { }
                session.endSession();
            }
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.command("menu", async (ctx) => {
        try {
            const user = await upsertUserFromCtx(ctx);
            await sendMenu(ctx, user);
        } catch (err) {
            console.error("menu cmd error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    async function ensureUser(ctx) {
        const user = await user_model.findOne({ user_id: ctx.from.id });
        if (!user) {
            await ctx.reply("Please use /start first.");
            return null;
        }
        return user;
    }

    async function ensureActive(ctx) {
        const user = await ensureUser(ctx);
        if (!user) return null;

        if (user.registration_status !== "ACTIVE") {
            await ctx.reply("Your account is not active yet. Please complete the first deposit.", pendingMenu());
            return null;
        }
        return user;
    }

    // ------------------------
    // PENDING: First deposit
    // ------------------------
    bot.hears(`💳 First Deposit ₹${depositAmount} ✅`, async (ctx) => {
        let session = null;
        try {
            const user = await ensureUser(ctx);
            if (!user) return;

            if (user.registration_status === "ACTIVE") {
                await ctx.reply("Your account is already active.", activeMenu());
                return;
            }

            const PROJECT_01_WATCHPAY_BASE_URL = process.env.PROJECT_01_WATCHPAY_BASE_URL || "https://api.watchglb.com";
            const PROJECT_01_WATCHPAY_MCH_ID = process.env.PROJECT_01_WATCHPAY_MCH_ID;
            const PROJECT_01_WATCHPAY_PAYMENT_KEY = process.env.PROJECT_01_WATCHPAY_PAYMENT_KEY;
            const PROJECT_01_WATCHPAY_PAY_TYPE = process.env.PROJECT_01_WATCHPAY_PAY_TYPE || "101";

            const GLOBLE_DOMAIN = process.env.GLOBLE_DOMAIN;
            const notify_url = `${GLOBLE_DOMAIN}/${process.env.PROJECT_01_TOKEN}/project-01/watchpay/notify/deposit`;
            const page_url = process.env.PROJECT_01_WATCHPAY_PAGE_URL || "https://example.com";

            if (!PROJECT_01_WATCHPAY_MCH_ID || !PROJECT_01_WATCHPAY_PAYMENT_KEY || !GLOBLE_DOMAIN) {
                await ctx.reply("Deposit is not configured. Missing env vars: PROJECT_01_WATCHPAY_MCH_ID, PROJECT_01_WATCHPAY_PAYMENT_KEY, GLOBLE_DOMAIN");
                return;
            }

            const mch_order_no = `FD${Date.now()}${String(ctx.from.id).slice(-4)}`;

            session = await project_01_connection.startSession();
            session.startTransaction();

            const created = await transactions_model.create(
                [
                    {
                        userDB_id: user._id,
                        type: "D",
                        amount: depositAmount,
                        status: "P",
                        note: `First deposit ₹${depositAmount} (WatchPay)`,
                        gateway: "WATCHPAY",
                        mch_order_no,
                        created_at: new Date(),
                    },
                ],
                { session },
            );

            const tx = created && created[0] ? created[0] : null;

            await session.commitTransaction();
            session.endSession();
            session = null;

            const resp = await createDepositOrder({
                baseUrl: PROJECT_01_WATCHPAY_BASE_URL,
                mch_id: PROJECT_01_WATCHPAY_MCH_ID,
                paymentKey: PROJECT_01_WATCHPAY_PAYMENT_KEY,
                notify_url,
                page_url,
                mch_order_no,
                pay_type: PROJECT_01_WATCHPAY_PAY_TYPE,
                trade_amount: depositAmount,
                goods_name: "First Deposit",
                mch_return_msg: String(user._id),
            });

            if (!resp || resp.respCode !== "SUCCESS") {
                if (tx?._id) {
                    await transactions_model.updateOne(
                        { _id: tx._id },
                        { $set: { status: "R", note: `Deposit create failed: ${resp?.tradeMsg || "unknown"}` } },
                    );
                }
                await ctx.reply(`Deposit init failed: ${resp?.tradeMsg || "unknown error"}`);
                return;
            }

            const payInfo = resp.payInfo;
            if (!payInfo) {
                await ctx.reply("Deposit init failed: payInfo missing.");
                return;
            }

            await ctx.reply(
                `💳 First Deposit: ₹${depositAmount}\n\nPlease complete your payment using the button below.`,
                Markup.inlineKeyboard([
                    [Markup.button.url("Pay Now", payInfo)],
                    [Markup.button.callback("Back to Menu", "P01_MENU")],
                ]),
            );
        } catch (err) {
            console.error("deposit start error:", err);
            if (session) {
                try {
                    await session.abortTransaction();
                } catch (_) { }
                session.endSession();
            }
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_MENU", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            const user = await ensureUser(ctx);
            if (!user) return;
            await sendMenu(ctx, user);
        } catch (err) {
            console.error("menu action error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Balance/Invite/Apps
    // ------------------------
    bot.hears("💰 Check Balance", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;
            await ctx.reply(`Your wallet balance is: ₹${Number(user.wallet_balance || 0).toFixed(2)}`, activeMenu());
        } catch (err) {
            console.error("balance error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.hears("🔗 Invite", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;
            const link = getInviteBotLink(user.invite_code);
            await ctx.reply(`Your invite code: ${user.invite_code}\nInvite link:\n${link}`, activeMenu());
        } catch (err) {
            console.error("invite error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.hears("🎁 Daily Bonus", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;
            const link = getMiniAppLink("daily-bonus", user._id.toString());
            await ctx.reply("Daily Bonus: Tap the button below to open the app.", Markup.inlineKeyboard([[Markup.button.url("Open Daily Bonus", link)]]));
        } catch (err) {
            console.error("daily bonus error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.hears("👥 Team Report", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;
            const link = getMiniAppLink("team-report", user._id.toString());
            await ctx.reply("Open Team Report:", Markup.inlineKeyboard([[Markup.button.url("Open Team Report", link)]]));
        } catch (err) {
            console.error("team report error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.hears("🧾 Transactions Report", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;
            const link = getMiniAppLink("transactions-report", user._id.toString());
            await ctx.reply("Open Transactions Report:", Markup.inlineKeyboard([[Markup.button.url("Open Transactions Report", link)]]));
        } catch (err) {
            console.error("transactions report error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Add/Update Bank Details
    // ------------------------
    bot.hears("🏦 Add/Update Bank Details", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const tgUserId = ctx.from.id;
            const b = getBankDetails(user);

            if (b.account_number && b.ifsc && b.bank_code) {
                setState(tgUserId, STEPS.CONFIRM_BANK_UPDATE, {});
                return ctx.reply(
                    `Current Bank Details:\n` +
                    `Holder: ${b.holder_name || "-"}\n` +
                    `Bank: ${b.bank_name || "-"} (${b.bank_code || "-"})\n` +
                    `A/C: ${safeMaskAccount(b.account_number)}\n` +
                    `IFSC: ${b.ifsc || "-"}\n\n` +
                    `Do you want to update?`,
                    Markup.inlineKeyboard([[Markup.button.callback("Yes", "P01_BANK_UPDATE_YES"), Markup.button.callback("No", "P01_BANK_UPDATE_NO")]]),
                );
            }

            setState(tgUserId, STEPS.WAIT_BANK_HOLDER, {});
            return ctx.reply("Send Account Holder Name:");
        } catch (err) {
            console.error("bank details start error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_BANK_UPDATE_YES", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            setState(ctx.from.id, STEPS.WAIT_BANK_HOLDER, {});
            return ctx.reply("Send Account Holder Name:");
        } catch (err) {
            console.error("bank update yes error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_BANK_UPDATE_NO", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            clearState(ctx.from.id);
            const user = await ensureActive(ctx);
            if (!user) return;
            return ctx.reply("Okay. Bank details unchanged.", activeMenu());
        } catch (err) {
            console.error("bank update no error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action(/^P01_BANK_PICK\|(.+)$/i, async (ctx) => {
        try {
            await ctx.answerCbQuery();

            const code = String(ctx.match[1] || "").trim();
            const bank = BANKS.find((b) => b.code === code);
            if (!bank) return ctx.reply("Invalid bank selection. Please try again.");

            const st = getState(ctx.from.id);
            const user = await ensureActive(ctx);
            if (!user) return;

            await user_model.updateOne(
                { _id: user._id },
                { $set: { "bank_details.bank_code": bank.code, "bank_details.bank_name": bank.name } },
            );

            setState(ctx.from.id, STEPS.WAIT_BANK_ACCOUNT, { ...(st.data || {}), bank_code: bank.code });

            return ctx.reply(`Selected Bank: ${bank.name}\nNow send Account Number (digits only):`);
        } catch (err) {
            console.error("bank pick error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_BANK_CANCEL", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            clearState(ctx.from.id);
            const user = await ensureActive(ctx);
            if (!user) return;
            return ctx.reply("Cancelled.", activeMenu());
        } catch (err) {
            console.error("bank cancel error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Withdraw (WatchPay Transfer)
    // ------------------------
    bot.hears("🏧 Withdraw", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const tgUserId = ctx.from.id;

            if (!hasBankDetails(user)) {
                setState(tgUserId, STEPS.WAIT_BANK_HOLDER, { next: "WITHDRAW" });
                return ctx.reply("Please add your bank details first.\nSend Account Holder Name:");
            }

            setState(tgUserId, STEPS.WAIT_WITHDRAW_AMOUNT, {});
            return ctx.reply(`Send withdrawal amount (₹).\nMinimum withdrawal: ₹${MIN_WITHDRAW_AMOUNT}\nNote: Amount must be a whole number (no decimals).`);
        } catch (err) {
            console.error("withdraw start error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_WITHDRAW_CONFIRM_NO", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            clearState(ctx.from.id);
            const user = await ensureActive(ctx);
            if (!user) return;
            await ctx.reply("Withdrawal cancelled.", activeMenu());
        } catch (err) {
            console.error("withdraw confirm no error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_WITHDRAW_CONFIRM_YES", async (ctx) => {
        let session = null;
        try {
            await ctx.answerCbQuery();

            const user = await ensureActive(ctx);
            if (!user) return;

            const st = getState(ctx.from.id);
            const amount = Number(st.data?.amount || 0);

            if (!amount || amount <= 0) {
                clearState(ctx.from.id);
                return ctx.reply("Invalid withdrawal request. Please try again.", activeMenu());
            }
            if (amount < MIN_WITHDRAW_AMOUNT) {
                clearState(ctx.from.id);
                return ctx.reply(`Minimum withdrawal amount is ₹${MIN_WITHDRAW_AMOUNT}.`, activeMenu());
            }
            if (!Number.isInteger(amount)) {
                return ctx.reply("Withdrawal amount must be a whole number (example: 2000). Please send again:");
            }

            // env
            const PROJECT_01_WATCHPAY_BASE_URL = process.env.PROJECT_01_WATCHPAY_BASE_URL;
            const PROJECT_01_WATCHPAY_MCH_ID = process.env.PROJECT_01_WATCHPAY_MCH_ID;
            const PROJECT_01_WATCHPAY_PAYMENT_KEY = process.env.PROJECT_01_WATCHPAY_PAYMENT_KEY;
            const GLOBLE_DOMAIN = process.env.GLOBLE_DOMAIN;

            if (!PROJECT_01_WATCHPAY_MCH_ID || !PROJECT_01_WATCHPAY_PAYMENT_KEY || !GLOBLE_DOMAIN) {
                clearState(ctx.from.id);
                return ctx.reply("Withdraw is not configured. Missing env vars: PROJECT_01_WATCHPAY_MCH_ID, PROJECT_01_WATCHPAY_PAYMENT_KEY, GLOBLE_DOMAIN", activeMenu());
            }

            const back_url = `${GLOBLE_DOMAIN}/${process.env.PROJECT_01_TOKEN}/project-01/watchpay/notify/withdraw`;

            // DB transaction: lock money + create tx
            session = await project_01_connection.startSession();
            session.startTransaction();

            const fresh = await user_model.findById(user._id).session(session);
            if (!fresh || Number(fresh.wallet_balance || 0) < amount) {
                await session.abortTransaction();
                session.endSession();
                session = null;
                clearState(ctx.from.id);
                return ctx.reply("Insufficient wallet balance.", activeMenu());
            }

            if (!hasBankDetails(fresh)) {
                await session.abortTransaction();
                session.endSession();
                session = null;
                clearState(ctx.from.id);
                return ctx.reply("Bank details missing. Please add bank details first.", activeMenu());
            }

            const b = getBankDetails(fresh);

            const mch_transferId = `WD${Date.now()}${String(ctx.from.id).slice(-4)}`;

            await transactions_model.create(
                [
                    {
                        userDB_id: fresh._id,
                        type: "W",
                        amount,
                        status: "P",
                        note: `Withdraw request to Bank`,
                        created_at: new Date(),
                        gateway: "WATCHPAY",
                        mch_order_no: mch_transferId, // map to mch_transferId
                    },
                ],
                { session },
            );

            await user_model.updateOne({ _id: fresh._id }, { $inc: { wallet_balance: -amount } }, { session });

            await session.commitTransaction();
            session.endSession();
            session = null;

            clearState(ctx.from.id);

            // Call WatchPay transfer (payout)
            let resp;
            try {
                resp = await createWithdrawOrder({
                    baseUrl: PROJECT_01_WATCHPAY_BASE_URL,
                    mch_id: PROJECT_01_WATCHPAY_MCH_ID,
                    paymentKey: PROJECT_01_WATCHPAY_PAYMENT_KEY,
                    mch_transferId,
                    transfer_amount: String(amount), // integer string
                    bank_code: b.bank_code,
                    receive_name: b.holder_name,
                    receive_account: b.account_number,
                    remark: String(b.ifsc || "").toUpperCase(), // India IFSC required here
                    back_url,
                });
            } catch (apiErr) {
                resp = null;
                console.error("WatchPay transfer API error:", apiErr?.response?.data || apiErr);
            }

            // Update tx with gateway response (best effort)
            if (resp && resp.respCode === "SUCCESS") {
                await transactions_model.updateOne(
                    { gateway: "WATCHPAY", mch_order_no: mch_transferId, type: "W" },
                    {
                        $set: {
                            gateway_order_no: String(resp.tradeNo || ""),
                            trade_result: String(resp.tradeResult || ""),
                            raw_callback: resp,
                        },
                    },
                );
            } else {
                // If request failed, mark rejected + refund wallet
                const failMsg = resp?.errorMsg ? String(resp.errorMsg) : "Transfer request failed";
                const s2 = await project_01_connection.startSession();
                s2.startTransaction();
                try {
                    await transactions_model.updateOne(
                        { gateway: "WATCHPAY", mch_order_no: mch_transferId, type: "W", status: "P" },
                        { $set: { status: "R", note: `Withdraw failed: ${failMsg}`, raw_callback: resp || null } },
                        { session: s2 },
                    );
                    await user_model.updateOne({ _id: user._id }, { $inc: { wallet_balance: amount } }, { session: s2 });
                    await s2.commitTransaction();
                } catch (e) {
                    try { await s2.abortTransaction(); } catch (_) { }
                    throw e;
                } finally {
                    s2.endSession();
                }

                return ctx.reply(`Withdrawal failed to submit to bank gateway.\nReason: ${failMsg}\nAmount refunded to wallet.`, activeMenu());
            }

            // Requested final message format
            return ctx.reply(
                `Withdrawal request submitted.\n` +
                `Amount: ₹${amount.toFixed(2)}\n` +
                `Order Id: ${mch_transferId}\n` +
                `Status: Pending\n\n` +
                `Please wait 24–48 hours for processing.\n` +
                `In some cases, it may take up to a maximum of 7 working days.`,
                activeMenu(),
            );
        } catch (err) {
            console.error("withdraw confirm yes error:", err);
            if (session) {
                try { await session.abortTransaction(); } catch (_) { }
                session.endSession();
            }
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // Text steps handler (Bank + Withdraw amount)
    // ------------------------
    bot.on("text", async (ctx) => {
        try {
            const tgUserId = ctx.from.id;
            const st = getState(tgUserId);
            if (!st.step) return;

            const user = await ensureActive(ctx);
            if (!user) {
                clearState(tgUserId);
                return;
            }

            const text = normalizeStr(ctx.message.text);

            // Bank flow
            if (st.step === STEPS.WAIT_BANK_HOLDER) {
                if (!text || text.length < 2) return ctx.reply("Invalid holder name. Send again:");
                await user_model.updateOne({ _id: user._id }, { $set: { "bank_details.holder_name": text } });

                setState(tgUserId, STEPS.WAIT_BANK_PICK, { ...(st.data || {}) });
                return ctx.reply("Select your bank from below:", bankKeyboard());
            }

            if (st.step === STEPS.WAIT_BANK_PICK) {
                return ctx.reply("Please select your bank using buttons:", bankKeyboard());
            }

            if (st.step === STEPS.WAIT_BANK_ACCOUNT) {
                if (!isValidAccountNumber(text)) return ctx.reply("Invalid account number. Send again (digits only):");
                await user_model.updateOne({ _id: user._id }, { $set: { "bank_details.account_number": text } });

                const bank_code = st.data?.bank_code || getBankDetails(user).bank_code;
                setState(tgUserId, STEPS.WAIT_BANK_IFSC, { ...(st.data || {}), bank_code });

                return ctx.reply(`Send IFSC code.\nExample for your selected bank: ${getIfscExample(bank_code)}`);
            }

            if (st.step === STEPS.WAIT_BANK_IFSC) {
                const ifsc = String(text || "").trim().toUpperCase();
                const bank_code = st.data?.bank_code || getBankDetails(user).bank_code;

                if (!isValidIfscStructure(ifsc)) {
                    return ctx.reply(`Invalid IFSC format.\nExample: ${getIfscExample(bank_code)}\nSend again:`);
                }

                const prefix = getIfscPrefix(bank_code);
                if (prefix && !ifsc.startsWith(prefix)) {
                    return ctx.reply(`This IFSC does not match selected bank.\nExpected like: ${getIfscExample(bank_code)}\nSend correct IFSC:`);
                }

                await user_model.updateOne({ _id: user._id }, { $set: { "bank_details.ifsc": ifsc } });

                const next = st.data?.next;
                clearState(tgUserId);

                if (next === "WITHDRAW") {
                    setState(tgUserId, STEPS.WAIT_WITHDRAW_AMOUNT, {});
                    return ctx.reply(`Bank details saved.\nNow send withdrawal amount (₹).\nMinimum: ₹${MIN_WITHDRAW_AMOUNT}\nNote: Amount must be a whole number (no decimals).`);
                }

                return ctx.reply("Bank details saved.", activeMenu());
            }

            // Withdraw amount step
            if (st.step === STEPS.WAIT_WITHDRAW_AMOUNT) {
                const amount = parseAmount(text);
                if (!amount || amount <= 0) return ctx.reply("Invalid amount. Send number only (example: 2000).");
                if (!Number.isInteger(amount)) return ctx.reply("Amount must be a whole number (example: 2000). Send again:");
                if (amount < MIN_WITHDRAW_AMOUNT) return ctx.reply(`Minimum withdrawal amount is ₹${MIN_WITHDRAW_AMOUNT}. Send higher amount:`);

                const fresh = await user_model.findById(user._id).lean();
                if (Number(fresh.wallet_balance || 0) < amount) {
                    return ctx.reply(`Insufficient wallet balance.\nCurrent: ₹${Number(fresh.wallet_balance || 0).toFixed(2)}`);
                }

                if (!hasBankDetails(fresh)) {
                    clearState(tgUserId);
                    setState(tgUserId, STEPS.WAIT_BANK_HOLDER, { next: "WITHDRAW" });
                    return ctx.reply("Bank details missing. Please add bank details first.\nSend Account Holder Name:");
                }

                setState(tgUserId, STEPS.WITHDRAW_CONFIRM, { amount });

                const b = getBankDetails(fresh);
                const msg =
                    `Please confirm your withdrawal:\n\n` +
                    `Amount: ₹${Number(amount).toFixed(2)}\n` +
                    `Holder: ${b.holder_name}\n` +
                    `Bank: ${b.bank_name} (${b.bank_code})\n` +
                    `A/C: ${safeMaskAccount(b.account_number)}\n` +
                    `IFSC: ${b.ifsc}\n`;

                return ctx.reply(
                    msg,
                    Markup.inlineKeyboard([[Markup.button.callback("Yes", "P01_WITHDRAW_CONFIRM_YES"), Markup.button.callback("No", "P01_WITHDRAW_CONFIRM_NO")]]),
                );
            }
        } catch (err) {
            console.error("text flow error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });
};
