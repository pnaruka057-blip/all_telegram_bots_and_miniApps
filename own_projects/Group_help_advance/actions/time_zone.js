const { Markup } = require("telegraf");
const moment = require("moment-timezone");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const normCity = (s = "") => s.trim().toLowerCase();

function getTZ(doc, chatIdStr) {
    return doc?.settings?.[chatIdStr]?.time_zone || {};
}
async function setTZ(userId, chatIdStr, tzName) {
    await user_setting_module.updateOne(
        { user_id: userId },
        { $setOnInsert: { user_id: userId }, $set: { [`settings.${chatIdStr}.time_zone.tz_name`]: tzName } },
        { upsert: true }
    );
}

// Validate IANA by moment-timezone
function isValidIANA(tz) {
    if (!/^[A-Za-z_]+\/[A-Za-z_\-+]+(?:\/[A-Za-z_\-+]+)?$/.test(tz)) return false;
    return moment.tz.zone(tz) != null;
}

// Current time string using tz_name (IANA or “GMT±HH:MM”)
function nowInZone(tzName) {
    if (tzName && moment.tz.zone(tzName)) {
        return moment().tz(tzName).format("DD/MM/YY HH:mm");
    }
    // Fallback for labels like "GMT+05:30"
    const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzName || "");
    if (m) {
        const sign = m[1] === "-" ? -1 : 1;
        const hh = parseInt(m[2], 10);
        const mm = parseInt(m[3], 10);
        const offsetMin = sign * (hh * 60 + mm);
        // Build ISO with fixed offset like +05:30
        const signStr = sign === -1 ? "-" : "+";
        const offStr = `${signStr}${pad2(hh)}:${pad2(mm)}`;
        // moment parsing with offset
        return moment().utcOffset(offsetMin).format("DD/MM/YY HH:mm");
    }
    // If not set, show server time
    return moment().format("DD/MM/YY HH:mm");
}

// From longitude → “GMT±HH:MM” label (approx, 30-min rounding)
function labelFromLongitude(lon) {
    const rawMinutes = lon / 15 * 60;
    const rounded = Math.max(-12 * 60, Math.min(14 * 60, Math.round(rawMinutes / 30) * 30));
    const sign = rounded >= 0 ? "+" : "-";
    const abs = Math.abs(rounded);
    return `GMT${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// City → IANA map
const CITY_TO_IANA = new Map([
    ["delhi", "Asia/Kolkata"], ["new delhi", "Asia/Kolkata"], ["mumbai", "Asia/Kolkata"], ["kolkata", "Asia/Kolkata"], ["bangalore", "Asia/Kolkata"], ["bengaluru", "Asia/Kolkata"], ["chennai", "Asia/Kolkata"], ["pune", "Asia/Kolkata"], ["hyderabad", "Asia/Kolkata"],
    ["karachi", "Asia/Karachi"], ["lahore", "Asia/Karachi"], ["islamabad", "Asia/Karachi"],
    ["dubai", "Asia/Dubai"], ["abu dhabi", "Asia/Dubai"], ["doha", "Asia/Qatar"], ["riyadh", "Asia/Riyadh"],
    ["london", "Europe/London"], ["paris", "Europe/Paris"], ["rome", "Europe/Rome"], ["berlin", "Europe/Berlin"], ["madrid", "Europe/Madrid"], ["moscow", "Europe/Moscow"],
    ["new york", "America/New_York"], ["nyc", "America/New_York"], ["los angeles", "America/Los_Angeles"], ["la", "America/Los_Angeles"], ["chicago", "America/Chicago"], ["seattle", "America/Los_Angeles"],
    ["tokyo", "Asia/Tokyo"], ["seoul", "Asia/Seoul"], ["singapore", "Asia/Singapore"], ["jakarta", "Asia/Jakarta"],
    ["sydney", "Australia/Sydney"], ["melbourne", "Australia/Melbourne"], ["auckland", "Pacific/Auckland"]
]);

// ---------- UI ----------
async function renderTZHome(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const tz = getTZ(doc, chatIdStr);
    const name = tz.tz_name?.trim() || "Not set";
    const nowStr = nowInZone(name);

    const text =
        `🌍 <b>Time Zone</b>\n\n` +
        `From this menu you can set the group Time Zone.\n` +
        `Bot needs it to send messages with correct dates.\n\n` +
        `<b>Actual:</b> ${esc(name)} (${nowStr})`;

    const rows = [
        [Markup.button.callback("✍️ Set", `TIMEZONE_SET_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

async function renderTZPrompt(ctx, chatIdStr, userId) {
    const text =
        `🌍 <b>Time Zone</b>\n` +
        `Send your position or type the time zone.\n\n` +
        `• Tap <b>📍 Send the position</b> below (or Attach → Location).\n` +
        `• Or type an <b>IANA time zone</b> like <code>Asia/Kolkata</code>.\n` +
        `• Or type a <b>city</b> (Delhi, Dubai, London, New York...).\n\n` +
        `<i>Your position is not saved; only the zone name will be stored.</i>`;

    const kb = {
        keyboard: [
            [{ text: "📍 Send the position", request_location: true }],
            [{ text: "❌ Cancel" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    };

    const sent = await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    const promptChatId = sent?.chat?.id || ctx.chat?.id || null;
    const promptMsgId = sent?.message_id || null;

    ctx.session = ctx.session || {};
    ctx.session.tzAwait = {
        chatIdStr,
        userId,
        promptMessage: promptChatId && promptMsgId ? { chatId: promptChatId, messageId: promptMsgId } : null
    };
}

// ---------- Module ----------
module.exports = (bot) => {
    // Open Time Zone home
    bot.action(/^NIGHT_TZ_(-?\d+)$/, async (ctx) => {
        try {
            ctx.session = {};
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;
            await renderTZHome(ctx, chatIdStr, userId);
        } catch (e) { console.error("TIMEZONE home error:", e); }
    });

    // Start Set flow
    bot.action(/^TIMEZONE_SET_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // Delete the last bot message (callback origin) if possible
            const cbMsg = ctx.callbackQuery?.message;
            if (cbMsg && cbMsg.chat && cbMsg.message_id) {
                try {
                    await ctx.telegram.deleteMessage(cbMsg.chat.id, cbMsg.message_id);
                } catch (_) {
                    // ignore failures: message too old / no rights / already deleted
                }
            }

            await renderTZPrompt(ctx, chatIdStr, userId);
            try { await ctx.answerCbQuery(); } catch (_) { }
        } catch (e) {
            console.error("TIMEZONE_SET error:", e);
        }
    });

    // Text: IANA/city/cancel
    bot.on("text", async (ctx, next) => {
        try {
            const awaiting = ctx.session?.tzAwait;
            if (!awaiting) return next();

            const { chatIdStr, userId, promptMessage } = awaiting;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const txt = (ctx.message.text || "").trim();
            if (/^❌\s*Cancel$/i.test(txt) || /^cancel$/i.test(txt)) {
                await ctx.reply("Cancelled.", { reply_markup: { remove_keyboard: true } }).catch(() => { });
                if (promptMessage) { try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch { } }
                delete ctx.session.tzAwait;
                await renderTZHome(ctx, chatIdStr, userId);
                return;
            }

            let tzName = null;

            if (isValidIANA(txt)) tzName = txt;
            if (!tzName) {
                const iana = CITY_TO_IANA.get(normCity(txt));
                if (iana && isValidIANA(iana)) tzName = iana;
            }

            if (!tzName) {
                await ctx.reply("❌ Unknown time zone or city. Try an IANA zone like Asia/Kolkata, or send your position.");
                return;
            }

            await setTZ(userId, chatIdStr, tzName);

            await ctx.reply("✅ Time Zone updated.", { reply_markup: { remove_keyboard: true } }).catch(() => { });
            if (promptMessage) { try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch { } }
            delete ctx.session.tzAwait;

            await renderTZHome(ctx, chatIdStr, userId);
        } catch (e) {
            console.error("TIMEZONE text handler error:", e);
            return next();
        }
    });

    // Location: approximate “GMT±HH:MM” label (non-DST)
    bot.on("location", async (ctx, next) => {
        try {
            const awaiting = ctx.session?.tzAwait;
            if (!awaiting) return next();

            const { chatIdStr, userId, promptMessage } = awaiting;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const loc = ctx.message?.location;
            if (!loc) return;

            const label = labelFromLongitude(loc.longitude);
            await setTZ(userId, chatIdStr, label);

            await ctx.reply(`✅ Time Zone set to approximately ${label}.`, { reply_markup: { remove_keyboard: true } }).catch(() => { });
            if (promptMessage) { try { await ctx.telegram.deleteMessage(promptMessage.chatId, promptMessage.messageId); } catch { } }
            delete ctx.session.tzAwait;

            await renderTZHome(ctx, chatIdStr, userId);
        } catch (e) {
            console.error("TIMEZONE location handler error:", e);
            return next();
        }
    });
};
