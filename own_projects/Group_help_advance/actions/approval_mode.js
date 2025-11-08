const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

const MODES = {
    button: { id: "button", label: "Button", emoji: "1️⃣" },
    recaptcha: { id: "recaptcha", label: "Recaptcha", emoji: "2️⃣" },
    presentation: { id: "presentation", label: "Presentation", emoji: "3️⃣" },
    regulation: { id: "regulation", label: "Regulation", emoji: "4️⃣" },
    math: { id: "math", label: "Math", emoji: "5️⃣" },
    quiz: { id: "quiz", label: "Quiz", emoji: "6️⃣" }
};

const esc = (s = "") =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function getApproval(doc, chatIdStr) {
    return doc?.settings?.[chatIdStr]?.approval || {};
}

async function setApproval(userId, chatIdStr, patch) {
    const $set = {};
    for (const [k, v] of Object.entries(patch)) {
        $set[`settings.${chatIdStr}.approval.${k}`] = v;
    }
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set },
        { upsert: true }
    );
}

async function renderApprovalMenu(ctx, chatIdStr, userId, isOwner) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const approval = getApproval(doc, chatIdStr);
    const isOn = approval.enabled === true;
    const mode = approval.verify_mode || "(not set)";

    const text =
        `📢 <b>Approval mode</b>\n\n` +
        `Through this menu you can delegate the management of group approvals to the bot for users who request to join.\n\n` +
        `ℹ️ <b>Important:</b> These settings will work <u>only</u> if the group’s <b>Approve new members</b> is turned ON in Telegram’s group settings. Otherwise the bot won’t receive join requests.\n\n` +
        `🧩 <b>Verification flow</b>\n` +
        `The bot will guide the requester in a private flow using the selected <b>Verification mode</b>. If the user completes it successfully, the bot will approve the join request; otherwise it can decline after a timeout.\n\n` +
        `<b>• Status</b>: ${isOn ? "✅ Activated" : "❌ Deactivated"}\n` +
        `<b>• Verification mode</b>: ${esc(mode)}` +
        `\n\n<i>👉 Use the buttons below to control this setting for <b>${(isOwner && isOwner.title) ? isOwner.title : chatIdStr}</b>.</i>`

    const rows = [];
    rows.push([
        Markup.button.callback("❌ Turn off", `APPROVAL_TURN_OFF_${chatIdStr}`),
        Markup.button.callback("✅ Turn on", `APPROVAL_TURN_ON_${chatIdStr}`)
    ]);
    rows.push([Markup.button.callback("🧠 Verification mode", `APPROVAL_MODE_${chatIdStr}`)]);
    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows },
        disable_web_page_preview: true
    });
}

async function renderModePicker(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const current = getApproval(doc, chatIdStr).verify_mode || "quiz";

    const text =
        `<b>🧠 Verification mode</b>\n\n` +
        `Choose how the bot should verify a requester in private chat <i>before</i> approving the join request.\n\n` +
        `Current: <b>${current.charAt(0).toUpperCase() + current.slice(1)}</b>\n\n` +
        `<b>Modes:</b>\n` +
        `${MODES.button.emoji} Button — User taps a button to confirm and is approved.\n` +
        `${MODES.recaptcha.emoji} Recaptcha — Opens a web page (Turnstile) to verify, then approve.\n` +
        `${MODES.presentation.emoji} Presentation — User must send a short intro within time.\n` +
        `${MODES.regulation.emoji} Regulation — User must accept your rules within time.\n` +
        `${MODES.math.emoji} Math — Solve a simple math challenge.\n` +
        `${MODES.quiz.emoji} Quiz — Answer a question correctly.\n\n` +
        `<i>Pick one:</i>`;

    const rows = [];
    const entries = Object.entries(MODES);
    for (let i = 0; i < entries.length; i += 2) {
        const left = entries[i], right = entries[i + 1];
        const Lkey = left[0], L = left[1];
        const Llabel = `${L.emoji} ${L.label}${current === Lkey ? " ✅" : ""}`;
        const row = [Markup.button.callback(Llabel, `APPROVAL_SET_MODE_${Lkey}_${chatIdStr}`)];
        if (right) {
            const Rkey = right[0], R = right[1];
            const Rlabel = `${R.emoji} ${R.label}${current === Rkey ? " ✅" : ""}`;
            row.push(Markup.button.callback(Rlabel, `APPROVAL_SET_MODE_${Rkey}_${chatIdStr}`));
        }
        rows.push(row);
    }
    rows.push([Markup.button.callback("⬅️ Back", `SET_APPROVAL_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

module.exports = (bot) => {
    // Open menu
    bot.action(/^SET_APPROVAL_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderApprovalMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("SET_APPROVAL error:", e); }
    });

    // Turn ON: if verify_mode not set, default to "quiz"
    bot.action(/^APPROVAL_TURN_ON_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const current = getApproval(doc, chatIdStr).verify_mode;

            const patch = { enabled: true };
            if (!current) patch.verify_mode = "quiz";

            await setApproval(userId, chatIdStr, patch);
            try { await ctx.answerCbQuery("Approval mode activated."); } catch { }
            await renderApprovalMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("APPROVAL_TURN_ON error:", e); }
    });

    // Turn OFF
    bot.action(/^APPROVAL_TURN_OFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await setApproval(userId, chatIdStr, { enabled: false });
            try { await ctx.answerCbQuery("Approval mode turned off."); } catch { }
            await renderApprovalMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("APPROVAL_TURN_OFF error:", e); }
    });

    // Open mode picker
    bot.action(/^APPROVAL_MODE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderModePicker(ctx, chatIdStr, userId);
        } catch (e) { console.error("APPROVAL_MODE error:", e); }
    });

    // Set selected verification mode
    bot.action(/^APPROVAL_SET_MODE_([a-z]+)_(-?\d+)$/, async (ctx) => {
        try {
            const chosen = ctx.match[1];
            const chatIdStr = ctx.match[2];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            if (!MODES[chosen]) { try { await ctx.answerCbQuery("Unknown mode."); } catch { } return; }

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await setApproval(userId, chatIdStr, { verify_mode: chosen });
            try { await ctx.answerCbQuery(`Verification mode set: ${MODES[chosen].label}`); } catch { }
            await renderApprovalMenu(ctx, chatIdStr, userId, ok);
        } catch (e) { console.error("APPROVAL_SET_MODE error:", e); }
    });
};
