const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

const ICON = {
    off: "❌",
    kick: "❗",
    mute: "🔇",
    ban: "🚫"
};

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function prettyMs(ms) {
    if (!ms || ms <= 0) return "None";
    const sec = Math.floor(ms / 1000);
    const units = [
        ["year", 31536000], ["month", 2592000], ["day", 86400],
        ["hour", 3600], ["minute", 60], ["second", 1]
    ];
    let rem = sec;
    const parts = [];
    for (const [name, size] of units) {
        if (rem >= size) {
            const n = Math.floor(rem / size);
            rem %= size;
            parts.push(`${n} ${name}${n > 1 ? "s" : ""}`);
            if (parts.length === 3) break;
        }
    }
    return parts.join(" ");
}

// Safe getter
function getWarnState(userDoc, chatIdStr) {
    return userDoc?.settings?.[chatIdStr]?.warns || {};
}

// Parse human duration
function parseHumanToMs(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim().toLowerCase();
    if (/^\d+$/.test(s)) {
        const ms = parseInt(s, 10) * 1000;
        return { ms, norm: `${s} seconds` };
    }
    const map = {
        s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
        m: 60000, min: 60000, mins: 60000, minute: 60000, minutes: 60000,
        h: 3600000, hour: 3600000, hours: 3600000,
        d: 86400000, day: 86400000, days: 86400000
    };
    let total = 0;
    const picked = [];
    const re = /(\d+)\s*([a-z]+)/g;
    let m;
    while ((m = re.exec(s))) {
        const val = parseInt(m[1], 10);
        const unit = m[2];
        const mult = map[unit];
        if (!mult) return null;
        total += val * mult;
        picked.push(`${val} ${unit}`);
    }
    if (total <= 0) return null;
    return { ms: total, norm: picked.join(" ") };
}

// --------- UI ---------
async function renderWarnMenu(ctx, chatIdStr, userId, isOwner) {
    ctx.session = {};
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const warns = getWarnState(userDoc, chatIdStr);
    const p = (warns.penalty || "mute").toLowerCase();
    const durStr = warns.penalty_duration_str || "None";
    const maxWarns = warns.max_warns || 3;

    let text =
        `❗ <b>User warnings</b>\n\n` +
        `Use this system to issue warnings for bad behavior before applying a penalty.\n\n` +
        `From this menu you can set:\n` +
        `• the <b>penalty</b> applied when a user exceeds the maximum warns\n` +
        `• the <b>maximum number</b> of warns allowed\n\n` +
        `Penalty: ${p.charAt(0).toUpperCase() + p.slice(1)}\n` +
        `Max Warns allowed: ${maxWarns}`;

    if (p === "mute" || p === "ban") {
        text += `\nPenalty duration: ${esc(durStr)}\n`;
        text += `\nIf the Penalty duration is <b>None</b>, the penalty will be applied permanently to the user.`;
        text += `\n\n<i>👉 Use the buttons below to control this setting for <b>${isOwner?.title}</b>.</i>`;
    }

    const rows = [];
    rows.push([Markup.button.callback("📄 Warned List", `WARNED_LIST_${chatIdStr}`)]);
    rows.push([
        Markup.button.callback(`${ICON.off} Off`, `WARN_SET_off_${chatIdStr}`),
        Markup.button.callback(`${ICON.kick} Kick`, `WARN_SET_kick_${chatIdStr}`)
    ]);
    rows.push([
        Markup.button.callback(`${ICON.mute} Mute`, `WARN_SET_mute_${chatIdStr}`),
        Markup.button.callback(`${ICON.ban} Ban`, `WARN_SET_ban_${chatIdStr}`)
    ]);

    if (p === "mute") {
        rows.push([Markup.button.callback(`⏲️ Set mute duration (${esc(durStr)})`, `WARN_SET_DUR_${chatIdStr}`)]);
    } else if (p === "ban") {
        rows.push([Markup.button.callback(`⏲️ Set ban duration (${esc(durStr)})`, `WARN_SET_DUR_${chatIdStr}`)]);
    }

    const nums = [3, 4, 5, 6];
    rows.push(nums.map(n => Markup.button.callback(`${n === maxWarns ? "✅" : ""}${n}`, `WARN_SET_MAX_${n}_${chatIdStr}`)));

    rows.push([Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows },
        disable_web_page_preview: true
    });
}

async function renderWarnedList(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const warns = getWarnState(doc, chatIdStr);
    const max = warns.max_warns || 3;
    const list = warns.warned || [];
    const lines = list.length === 0
        ? "No users have reached the warn limit."
        : list.map(u =>
            `• <code>${u.user_id}</code> ${u.username ? `@${u.username}` : ""} ${u.name ? esc(u.name) : ""}`
        ).join("\n");

    const text = `<b>WARNED USERS (Max Warns allowed ${max})</b>\n\n${lines}`;

    const rows = [];
    if (list.length > 0) {
        rows.push([Markup.button.callback("✅ Free all", `WARN_FREE_ALL_${chatIdStr}`)]);
    }
    rows.push([Markup.button.callback("⬅️ Back", `SET_WARNS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// --------- Mutations ---------
async function setPenalty(userId, chatIdStr, penalty) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $set: { [`settings.${chatIdStr}.warns.penalty`]: penalty } }
    );
}

async function setDuration(userId, chatIdStr, ms, norm) {
    await user_setting_module.updateOne(
        { user_id: userId },
        {
            $set: {
                [`settings.${chatIdStr}.warns.penalty_duration`]: ms,
                [`settings.${chatIdStr}.warns.penalty_duration_str`]: norm
            }
        }
    );
}

async function setMaxWarns(userId, chatIdStr, max) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $set: { [`settings.${chatIdStr}.warns.max_warns`]: max } }
    );
}

async function freeAllWarned(userId, chatIdStr) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $set: { [`settings.${chatIdStr}.warns.warned`]: [] } }
    );
}

// --------- Module ---------
module.exports = (bot) => {
    // Open menu
    bot.action(/^SET_WARNS_(-?\d+)$/, async ctx => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;
        await renderWarnMenu(ctx, chatIdStr, userId, ok);
    });

    // Warned list
    bot.action(/^WARNED_LIST_(-?\d+)$/, async ctx => {
        const chatIdStr = ctx.match[1];
        const chatId = Number(chatIdStr);
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;
        await renderWarnedList(ctx, chatIdStr, userId);
    });

    // Set penalty
    bot.action(/^WARN_SET_(off|kick|mute|ban)_(-?\d+)$/, async ctx => {
        const penalty = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        if (penalty === 'mute' || penalty === 'ban') {
            await setDuration(userId, chatIdStr, 10 * 60 * 1000, "10 minutes")
        }
        const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
        if (!ok) return;
        await setPenalty(userId, chatIdStr, penalty);
        await renderWarnMenu(ctx, chatIdStr, userId, ok);
    });

    // Open duration prompt (QUOTE-like flow with prompt tracking)
    bot.action(/^WARN_SET_DUR_(-?\d+)$/, async ctx => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const warns = getWarnState(userDoc, chatIdStr);
            const penalty = (warns.penalty || "mute").toLowerCase();
            if (penalty !== "mute" && penalty !== "ban") {
                await ctx.answerCbQuery("Duration is only for Mute/Ban.", { show_alert: true });
                return;
            }

            const current = warns.penalty_duration_str || "None";
            const example = "3 month 2 days 12 hours 4 minutes 34 seconds";
            const text =
                `⏲️ <b>Send now the duration for ${penalty.toUpperCase()} penalty</b>\n\n` +
                `<b>Minimum:</b> 30 seconds\n` +
                `<b>Maximum:</b> 365 days\n\n` +
                `<b>Example of format:</b> <code>${example}</code>\n\n` +
                `<b>Current duration:</b> ${esc(current)}\n\n`;

            const buttons = [
                [Markup.button.callback("🗑️ Remove duration", `WARN_DUR_REMOVE_${chatIdStr}`)],
                [Markup.button.callback("❌ Cancel", `WARN_DUR_CANCEL_${chatIdStr}`)]
            ];

            const sent = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } });

            // Prompt tracking as in your QUOTE flow
            let promptChatId = null, promptMsgId = null;
            if (sent && typeof sent === "object" && (sent.message_id || sent.messageId || sent.id)) {
                promptMsgId = sent.message_id || sent.messageId || sent.id;
                promptChatId = (sent.chat && sent.chat.id) ? sent.chat.id : (ctx.chat && ctx.chat.id) ? ctx.chat.id : null;
            } else if (ctx.callbackQuery && ctx.callbackQuery.message) {
                promptChatId = ctx.callbackQuery.message.chat.id;
                promptMsgId = ctx.callbackQuery.message.message_id;
            } else if (ctx.message && ctx.message.message_id) {
                promptChatId = ctx.chat && ctx.chat.id ? ctx.chat.id : null;
                promptMsgId = ctx.message.message_id;
            }

            ctx.session = ctx.session || {};
            ctx.session.warnDurAwait = { chatIdStr, userId, promptMessage: promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null };

            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (err) {
            console.error("WARN_SET_DUR open error:", err);
        }
    });

    // Remove duration
    bot.action(/^WARN_DUR_REMOVE_(-?\d+)$/, async ctx => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $set: {
                        [`settings.${chatIdStr}.warns.penalty_duration`]: 0,
                        [`settings.${chatIdStr}.warns.penalty_duration_str`]: "None"
                    }
                }
            );

            if (ctx.session?.warnDurAwait?.promptMessage) {
                const { chatId: pChatId, messageId: pMsgId } = ctx.session.warnDurAwait.promptMessage;
                try { await ctx.telegram.deleteMessage(pChatId, pMsgId); } catch (_) { }
            }
            if (ctx.session?.warnDurAwait) delete ctx.session.warnDurAwait;

            await ctx.answerCbQuery("Duration removed");
            await renderWarnMenu(ctx, chatIdStr, userId, ok);
        } catch (err) {
            console.error("WARN_DUR_REMOVE error:", err);
        }
    });

    // Cancel duration prompt
    bot.action(/^WARN_DUR_CANCEL_(-?\d+)$/, async ctx => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            if (ctx.session?.warnDurAwait?.promptMessage) {
                const { chatId: pChatId, messageId: pMsgId } = ctx.session.warnDurAwait.promptMessage;
                try { await ctx.telegram.deleteMessage(pChatId, pMsgId); } catch (_) { }
            }
            if (ctx.session?.warnDurAwait) delete ctx.session.warnDurAwait;

            await ctx.answerCbQuery("Cancelled");
            await renderWarnMenu(ctx, chatIdStr, userId, ok);
        } catch (err) {
            console.error("WARN_DUR_CANCEL error:", err);
        }
    });

    // Set max warns
    bot.action(/^WARN_SET_MAX_(\d{1,})_(-?\d+)$/, async ctx => {
        const max = parseInt(ctx.match[1]);
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await setMaxWarns(userId, chatIdStr, max);
        await renderWarnMenu(ctx, chatIdStr, userId, ok);
    });

    // Free all warned users
    bot.action(/^WARN_FREE_ALL_(-?\d+)$/, async ctx => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        await freeAllWarned(userId, chatIdStr);
        await renderWarnedList(ctx, chatIdStr, userId);
    });

    // Duration text capture with validation and prompt cleanup
    bot.on("text", async (ctx, next) => {
        try {
            const awaitObj = ctx.session?.warnDurAwait;
            if (!awaitObj) return next();

            const { chatIdStr, userId, promptMessage } = awaitObj;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // Ensure penalty still allows duration
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const warns = getWarnState(doc, chatIdStr);
            const p = (warns.penalty || "mute").toLowerCase();
            if (p !== "mute" && p !== "ban") {
                if (promptMessage) { try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { } }
                delete ctx.session.warnDurAwait;
                await renderWarnMenu(ctx, chatIdStr, userId, ok);
                return;
            }

            const raw = (ctx.message.text || "").trim();
            const parsed = parseHumanToMs(raw);
            const MIN_MS = 30 * 1000;
            const MAX_MS = 365 * 24 * 3600 * 1000;

            if (!parsed || parsed.ms < MIN_MS || parsed.ms > MAX_MS) {
                const txt =
                    `❌ Invalid duration.\n\n` +
                    `<b>Minimum:</b> 30 seconds\n` +
                    `<b>Maximum:</b> 365 days\n\n` +
                    `Examples:\n- 30s\n- 10m\n- 2 hours\n- 3 days 4 hours\n\n` +
                    `Send again or Cancel.`;
                await safeEditOrSend(ctx, txt, {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `WARN_DUR_CANCEL_${chatIdStr}`)]] }
                });
                return;
            }

            await setDuration(userId, chatIdStr, parsed.ms, parsed.norm);

            if (promptMessage) {
                try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch (_) { }
            }
            delete ctx.session.warnDurAwait;

            await ctx.reply(`✅ Duration set to ${prettyMs(parsed.ms)} (${parsed.norm}).`);
            await renderWarnMenu(ctx, chatIdStr, userId, ok);
        } catch (err) {
            console.error("WARN duration text handler error:", err);
            return next();
        }
    });
};
