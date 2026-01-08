const crypto = require("crypto");
const axios = require("axios");

function md5Lower(str) {
    return crypto.createHash("md5").update(str, "utf8").digest("hex"); // lower by default
}

function buildSignString(params, merchantKey, signField = "sign", signTypeField = "sign_type") {
    const keys = Object.keys(params)
        .filter((k) => k !== signField && k !== signTypeField)
        .filter((k) => params[k] !== undefined && params[k] !== null && String(params[k]) !== "")
        .sort(); // ASCII sort for normal key names

    const qs = keys.map((k) => `${k}=${params[k]}`).join("&");
    return `${qs}&key=${merchantKey}`;
}

function signRequest(params, merchantKey) {
    const signStr = buildSignString(params, merchantKey, "sign", "sign_type");
    return md5Lower(signStr);
}

function verifyCallback(params, merchantKey) {
    const received = String(params.sign || "").toLowerCase();
    const signStr = buildSignString(params, merchantKey, "sign", "signType"); // NOTE: callback uses signType
    const expected = md5Lower(signStr);
    return received && received === expected;
}

function nowFmt() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function createDepositOrder({
    baseUrl,
    mch_id,
    paymentKey,
    notify_url,
    page_url,
    mch_order_no,
    pay_type,
    trade_amount,
    goods_name,
    mch_return_msg,
}) {
    // version=1.0 => JSON response (as per your doc text)
    const payload = {
        version: "1.0",
        mch_id: String(mch_id),
        notify_url: String(notify_url),
        page_url: page_url ? String(page_url) : "",
        mch_order_no: String(mch_order_no),
        pay_type: String(pay_type),
        trade_amount: String(trade_amount),
        order_date: nowFmt(),
        goods_name: String(goods_name || "Deposit"),
        mch_return_msg: mch_return_msg ? String(mch_return_msg) : "",
        sign_type: "MD5",
    };

    payload.sign = signRequest(payload, paymentKey);

    const url = `${baseUrl.replace(/\/+$/, "")}/pay/web`;

    const form = new URLSearchParams();
    Object.entries(payload).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v) !== "") form.append(k, String(v));
    });

    const { data } = await axios.post(url, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
    });

    // Expected JSON like: { respCode, tradeResult, payInfo, ... }
    return data;
}

module.exports = {
    createDepositOrder,
    verifyCallback,
};