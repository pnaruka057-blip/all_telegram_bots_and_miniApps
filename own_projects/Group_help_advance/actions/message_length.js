const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const user_setting_module = require("../models/user_settings_module");

// ----- Helpers ------------------------------------------------

function settingPath(chatIdStr, path) {
    return `settings.${chatIdStr}.msglen.${path}`;
}
function getState(doc, chatIdStr) {
    const base = doc?.settings?.[chatIdStr]?.msglen || {};
    return {
        enabled: base.enabled === true,
        penalty: base.penalty || "off", // off | warn | kick
        mute: base.mute === true,
        ban: base.ban === true,
        delete_messages: base.delete_messages === true,
        min: Number.isInteger(base.min) ? base.min : null,
        max: Number.isInteger(base.max) ? base.max : null // allow "No limit" as null
    };
}
function yn(b) { return b ? "Yes ✅" : "No ✖️"; }
function ptxt(p) {
    if (p === "warn") return "Warn ⚠️";
    if (p === "kick") return "Kick ❗";
    return "Off ❌";
}
const chunk = (arr, n) => arr.reduce((acc, x, i) => {
    if (i % n === 0) acc.push([]);
    acc[acc.length - 1].push(x);
    return acc;
}, []);
const sel = (label, selected) => selected ? `» ${label} «` : String(label);

// ----- Renderers ---------------------------------------------

async function renderMenu(ctx, chatIdStr, userId, isOwner) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const s = getState(doc, chatIdStr);

    const maxTxt = Number.isInteger(s.max) ? s.max : "No limit";
    const minTxt = Number.isInteger(s.min) ? s.min : "No limit";

    const body =
        `🖋 <b>Message length</b>\n` +
        `From this menu you can set a minimum/maximum character length for messages sent by users.\n\n` +
        `Penalty: ${ptxt(s.penalty)}\n` +
        `Deletion: ${yn(s.delete_messages)}\n` +
        `Minimum length: ${minTxt}\n` +
        `Maximum length: ${maxTxt}`;

    const rows = [
        [
            Markup.button.callback("❌ Off", `ML_PEN_off_${chatIdStr}`),
            Markup.button.callback("⚠️ Warn", `ML_PEN_warn_${chatIdStr}`),
            Markup.button.callback("❗ Kick", `ML_PEN_kick_${chatIdStr}`)
        ],
        [
            Markup.button.callback("🔇 Mute", `ML_TOGGLE_mute_${chatIdStr}`),
            Markup.button.callback("🚫 Ban", `ML_TOGGLE_ban_${chatIdStr}`)
        ],
        [
            Markup.button.callback(`🗑 Delete Messages`, `ML_TOGGLE_del_${chatIdStr}`)
        ],
        [Markup.button.callback("🔻 Minimum length", `ML_SET_MIN_${chatIdStr}`)],
        [Markup.button.callback("🔺 Maximum length", `ML_SET_MAX_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, body, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Min picker (grid like screenshot 1)
async function renderMinPicker(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const s = getState(doc, chatIdStr);
    const current = Number.isInteger(s.min) ? s.min : 0; // treat null as 0 for display

    const values = [5, 10, 20, 25, 50, 100, 200, 400, 800, 1000, 1500, 2000];
    const rows = [];

    // Header: No limit (means min = 0)
    const noLimitSelected = current === 0;
    rows.push([Markup.button.callback(sel("No limit", noLimitSelected), `ML_MIN_PICK_NL_${chatIdStr}`)]);

    // Grid 3 per row
    const triples = chunk(values, 3);
    for (const row of triples) {
        rows.push(row.map(v => Markup.button.callback(sel(v, current === v), `ML_MIN_PICK_${v}_${chatIdStr}`)));
    }

    rows.push([Markup.button.callback("⬅️ Back", `MESSAGE_LENGTH_${chatIdStr}`)]);

    await safeEditOrSend(ctx, "Choose minimum length:", {
        reply_markup: { inline_keyboard: rows }
    });
}

// Max picker (grid like screenshot 2)
async function renderMaxPicker(ctx, chatIdStr, userId) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const s = getState(doc, chatIdStr);
    const current = Number.isInteger(s.max) ? s.max : null; // null = No limit

    const values = [50, 100, 150, 200, 400, 800, 1000, 1500, 2000, 2500, 3000, 3500];
    const rows = [];

    // Header: No limit (means max = null)
    const noLimitSelected = current === null;
    rows.push([Markup.button.callback(sel("No limit", noLimitSelected), `ML_MAX_PICK_NL_${chatIdStr}`)]);

    // Grid 3 per row
    const triples = chunk(values, 3);
    for (const row of triples) {
        rows.push(row.map(v => Markup.button.callback(sel(v, current === v), `ML_MAX_PICK_${v}_${chatIdStr}`)));
    }

    rows.push([Markup.button.callback("⬅️ Back", `MESSAGE_LENGTH_${chatIdStr}`)]);

    await safeEditOrSend(ctx, "Choose maximum length:", {
        reply_markup: { inline_keyboard: rows }
    });
}

// ----- Module -------------------------------------------------

module.exports = (bot) => {
    // Open menu
    bot.action(/^MESSAGE_LENGTH_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderMenu(ctx, chatIdStr, userId, ok);
    });

    // Set penalty
    bot.action(/^ML_PEN_(off|warn|kick)_(-?\d+)$/, async (ctx) => {
        const penalty = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [settingPath(chatIdStr, "penalty")]: penalty, [settingPath(chatIdStr, "enabled")]: penalty !== "off" } }
        );
        try { await ctx.answerCbQuery(`Penalty: ${penalty}`); } catch { }
        await renderMenu(ctx, chatIdStr, userId, ok);
    });

    // Toggles: mute / ban / delete_messages
    bot.action(/^ML_TOGGLE_(mute|ban|del)_(-?\d+)$/, async (ctx) => {
        const fieldKey = ctx.match[1] === "del" ? "delete_messages" : ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const current = !!doc?.settings?.[chatIdStr]?.msglen?.[fieldKey];
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [settingPath(chatIdStr, fieldKey)]: !current } }
        );
        try { await ctx.answerCbQuery(`${fieldKey}: ${!current ? "on" : "off"}`); } catch { }
        await renderMenu(ctx, chatIdStr, userId, ok);
    });

    // Open Minimum picker (buttons)
    bot.action(/^ML_SET_MIN_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderMinPicker(ctx, chatIdStr, userId);
    });

    // Open Maximum picker (buttons)
    bot.action(/^ML_SET_MAX_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderMaxPicker(ctx, chatIdStr, userId);
    });

    // Pick Minimum: number or NL (no limit => 0)
    bot.action(/^ML_MIN_PICK_(NL|\d+)_(-?\d+)$/, async (ctx) => {
        const pick = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        let newMin = pick === "NL" ? 0 : Math.max(0, Math.min(4000, parseInt(pick, 10)));
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [settingPath(chatIdStr, "min")]: newMin } }
        );

        // Ensure min <= max if max exists
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const curMax = doc?.settings?.[chatIdStr]?.msglen?.max;
        if (Number.isInteger(curMax) && newMin > curMax) {
            await user_setting_module.updateOne(
                { user_id: userId },
                { $set: { [settingPath(chatIdStr, "max")]: newMin } }
            );
        }

        try { await ctx.answerCbQuery(`Minimum: ${newMin === 0 ? "No limit" : newMin}`); } catch { }
        await renderMinPicker(ctx, chatIdStr, userId);
    });

    // Pick Maximum: number or NL (no limit => null)
    bot.action(/^ML_MAX_PICK_(NL|\d+)_(-?\d+)$/, async (ctx) => {
        const pick = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        const newMax = pick === "NL" ? null : Math.max(1, Math.min(4096, parseInt(pick, 10)));
        await user_setting_module.updateOne(
            { user_id: userId },
            { $set: { [settingPath(chatIdStr, "max")]: newMax } }
        );

        // Ensure min <= max when max is finite
        if (newMax !== null) {
            const doc = await user_setting_module.findOne({ user_id: userId }).lean();
            const curMin = doc?.settings?.[chatIdStr]?.msglen?.min ?? 0;
            if (curMin > newMax) {
                await user_setting_module.updateOne(
                    { user_id: userId },
                    { $set: { [settingPath(chatIdStr, "min")]: newMax } }
                );
            }
        }

        try { await ctx.answerCbQuery(`Maximum: ${newMax === null ? "No limit" : newMax}`); } catch { }
        await renderMaxPicker(ctx, chatIdStr, userId);
    });
};
