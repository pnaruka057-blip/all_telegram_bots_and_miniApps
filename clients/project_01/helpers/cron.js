// cron.js

require("dotenv").config();

const cron = require("node-cron");

const { project_01_connection } = require("../../../globle_helper/mongoDB_connection");

const user_model = require("../models/user_module");
const invite_model = require("../models/invite_model"); // kept as-is (no change)
const other_model = require("../models/other_model");   // kept as-is (no change)

const transactions_model = require("../models/transactions_model");

const { queryTransferOrder } = require("../helpers/watchpay");

// ------------------------- Start Cron -------------------------

function startCron() {
    // Doc suggests every 5 minutes. (If you want 30 min: "*/30 * * * *")
    // cron.schedule("*/4 * * * *", () => {
    //     console.log("run cron for payment");
    //     runJob().catch(() => { });
    // });

    cron.schedule(
        "0 0 * * *",
        async () => {
            try {
                const result = await user_model.updateMany(
                    {}, // sabhi users
                    {
                        $set: {
                            "tab_tab_game.balance": 0,
                            "tab_tab_game.count": 0,
                            "tab_tab_game.auto_credited_flag": false
                        }
                    }
                );
            } catch (error) {
                console.error("❌ Error while resetting tab_tab_game:", error);
            }
        },
        {
            timezone: "Asia/Kolkata" // IMPORTANT for India
        }
    );
}

// ------------------------- Job Runner -------------------------

function pickFirstDefined(obj, keys, fallback = undefined) {
    for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== "") return obj[k];
    }
    return fallback;
}

async function runJob() {
    const WATCHPAYBASEURL = process.env.PROJECT_01_WATCHPAY_BASE_URL;
    const WATCHPAYMCHID = process.env.PROJECT_01_WATCHPAY_MCH_ID;
    const WATCHPAYPAYMENTKEY = process.env.PROJECT_01_WATCHPAY_PAYMENT_KEY;

    if (!WATCHPAYBASEURL || !WATCHPAYMCHID || !WATCHPAYPAYMENTKEY) return;

    // Only pending transactions (Deposit "D" and Withdrawal "W") for WATCHPAY
    // NOTE: schema field naming differs across files in this project, so query is tolerant.
    const pendingQuery = {
        gateway: "WATCHPAY",
        status: "P",
        type: { $in: ["D", "W"] },
        $or: [
            { mch_order_no: { $exists: true, $ne: "" } },
            { mchorderno: { $exists: true, $ne: "" } },
            { mchOrderNo: { $exists: true, $ne: "" } }, // just in case
            { mch_transferId: { $exists: true, $ne: "" } },
            { mchTransferId: { $exists: true, $ne: "" } }
        ]
    };

    const list = await transactions_model
        .find(pendingQuery)
        .sort({ created_at: 1, createdat: 1, _id: 1 })
        .limit(200);

    if (!list || !list.length) return;

    for (const tx of list) {
        try {
            await processSinglePendingTx(tx, {
                baseUrl: WATCHPAYBASEURL,
                mch_id: WATCHPAYMCHID,
                paymentKey: WATCHPAYPAYMENTKEY
            });
        } catch (e) {
            // keep silent to avoid crashing cron loop
        }
    }
}

async function processSinglePendingTx(txDoc, cfg) {
    // Skip if already processed (extra safety)
    const currentStatus = String(pickFirstDefined(txDoc, ["status"], "P")).toUpperCase();
    if (currentStatus !== "P") return;

    // Optional: skip very new tx (<2 minutes) to match doc guidance (2-3 mins after payment)
    const createdAt =
        pickFirstDefined(txDoc, ["created_at", "createdat", "createdAt"], null) || null;
    if (createdAt) {
        const ageMs = Date.now() - new Date(createdAt).getTime();
        if (Number.isFinite(ageMs) && ageMs < 2 * 60 * 1000) return;
    }

    // Get merchant transfer/order id (stored during withdraw or deposit create)
    const mchTransferId = String(
        pickFirstDefined(txDoc, ["mch_transferId", "mchTransferId", "mch_order_no", "mchorderno", "mchOrderNo"], "")
    ).trim();

    if (!mchTransferId) return;

    const resp = await queryTransferOrder({
        baseUrl: cfg.baseUrl,
        mch_id: cfg.mch_id,
        paymentKey: cfg.paymentKey,
        mch_transferId: mchTransferId
    });

    // If gateway says FAIL, do not change status (still pending)
    const respCode = String(resp?.respCode || "").toUpperCase();
    if (respCode !== "SUCCESS") {
        // store last raw response for debugging (best-effort)
        await safeUpdateTx(txDoc, {
            raw_callback: resp,
            rawcallback: resp
        });
        return;
    }

    // tradeResult: 0 application successful, 1 transfer successful, 2 failed, 3 rejected, 4 processing
    const tradeResultRaw = resp?.tradeResult;
    const tradeResultNum = Number(tradeResultRaw);

    // Always store gateway info
    const gatewayTradeNo = String(resp?.tradeNo || resp?.trade_no || "").trim();

    await safeUpdateTx(txDoc, {
        trade_result: tradeResultRaw !== undefined ? String(tradeResultRaw) : "",
        traderesult: tradeResultRaw !== undefined ? String(tradeResultRaw) : "",
        gateway_order_no: gatewayTradeNo,
        gatewayorderno: gatewayTradeNo,
        raw_callback: resp,
        rawcallback: resp
    });

    // Map tradeResult to local tx status update
    // 1 => Success, 2/3 => Rejected, 0/4 => keep Pending
    if (tradeResultNum === 1) {
        await finalizeSuccess(txDoc, resp);
        return;
    }

    if (tradeResultNum === 2 || tradeResultNum === 3) {
        await finalizeRejected(txDoc, resp);
        return;
    }

    // tradeResult 0 or 4 => still pending (no status change)
}

async function safeUpdateTx(txDoc, setObj) {
    // update by _id to avoid stale doc issues
    const id = txDoc?._id || txDoc?.id;
    if (!id) return;

    // Best-effort update: set only (do not change status here)
    await transactions_model.updateOne(
        { _id: id },
        {
            $set: {
                ...setObj
            }
        }
    );
}

async function finalizeSuccess(txDoc, resp) {
    const id = txDoc?._id || txDoc?.id;
    if (!id) return;

    // Update tx status to Success (S)
    await transactions_model.updateOne(
        { _id: id, status: "P" },
        {
            $set: {
                status: "S",
                processed_at: new Date(),
                processedat: new Date(),
                trade_result: resp?.tradeResult !== undefined ? String(resp.tradeResult) : "",
                traderesult: resp?.tradeResult !== undefined ? String(resp.tradeResult) : "",
                gateway_order_no: String(resp?.tradeNo || ""),
                gatewayorderno: String(resp?.tradeNo || ""),
                raw_callback: resp,
                rawcallback: resp
            }
        }
    );

    // If it is a Deposit and you want to activate user on success (common in your flow)
    const txType = String(txDoc?.type || "").toUpperCase();
    if (txType === "D") {
        const userId =
            pickFirstDefined(txDoc, ["userDB_id", "userDBid", "userDBId", "user_id", "userId"], null) ||
            null;

        if (userId) {
            await user_model.updateOne(
                { _id: userId, registrationstatus: { $ne: "ACTIVE" } },
                { $set: { registrationstatus: "ACTIVE", activatedat: new Date() } }
            );
        }
    }
}

async function finalizeRejected(txDoc, resp) {
    const id = txDoc?._id || txDoc?.id;
    if (!id) return;

    // Update tx status to Rejected (R)
    const updateRes = await transactions_model.updateOne(
        { _id: id, status: "P" },
        {
            $set: {
                status: "R",
                processed_at: new Date(),
                processedat: new Date(),
                trade_result: resp?.tradeResult !== undefined ? String(resp.tradeResult) : "",
                traderesult: resp?.tradeResult !== undefined ? String(resp.tradeResult) : "",
                gateway_order_no: String(resp?.tradeNo || ""),
                gatewayorderno: String(resp?.tradeNo || ""),
                raw_callback: resp,
                rawcallback: resp
            }
        }
    );

    // If not updated (already processed), stop
    if (!updateRes || !updateRes.matchedCount) return;

    // If it is a Withdrawal, refund wallet (because bot deducts wallet at request time)
    const txType = String(txDoc?.type || "").toUpperCase();
    if (txType === "W") {
        const userId =
            pickFirstDefined(txDoc, ["userDB_id", "userDBid", "userDBId", "user_id", "userId"], null) ||
            null;

        const amount = Number(pickFirstDefined(txDoc, ["amount"], 0)) || 0;

        if (userId && amount > 0) {
            await user_model.updateOne(
                { _id: userId },
                {
                    $inc: { walletbalance: amount }
                }
            );
        }
    }
}

module.exports = { startCron };