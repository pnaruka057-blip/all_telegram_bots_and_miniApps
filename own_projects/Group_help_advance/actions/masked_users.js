const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const user_setting_module = require("../models/user_settings_module");

// Paths / state
const mp = (chatIdStr, key) => `settings.${chatIdStr}.masked_users.${key}`;
const getState = (doc, chatIdStr) => {
    const m = doc?.settings?.[chatIdStr]?.masked_users || {};
    return {
        enabled: m.enabled === true,
        delete_messages: m.delete_messages === true,
        whitelist: Array.isArray(m.whitelist) ? m.whitelist : []
    };
};

// Main UI -----------------------------------------------------
async function renderMain(ctx, chatIdStr, userId, isOwner) {
    const doc = await user_setting_module.findOne({ user_id: userId }).lean();
    const s = getState(doc, chatIdStr);

    const status =
        s.enabled && s.delete_messages ? "Active + Deletion" :
            s.enabled ? "Active" :
                "Deactivated";

    const text =
        `🫥 <b>Masked users</b>\n` +
        `Through this menu you can set a punishment for users who write in the group masquerading as a channel.\n\n` +
        `ℹ️ Telegram allows each user to write to the group by hiding through a channel they own.\n\n` +
        `🧑‍💼 It’s not possible to know which user is writing via a channel and if it is an administrator: this block will apply to <u>whoever writes via a channel</u>.\n\n` +
        `🛠 If this option is active, a user who was writing via a channel will only be able to continue writing to the group but only via his real identity and no longer via other channels.\n\n` +
        `💡 <b>Status:</b> ${status}`;

    const rows = [
        [
            Markup.button.callback("⛔ Turn off", `MU_OFF_${chatIdStr}`),
            Markup.button.callback("✅ Turn on", `MU_ON_${chatIdStr}`)
        ],
        [
            Markup.button.callback(`🗑 Delete Messages ${s.delete_messages ? "✅" : "✖️"}`, `MU_DEL_${chatIdStr}`)
        ],
        [
            Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`),
            Markup.button.callback("🌟 Exceptions", `MU_EXC_${chatIdStr}`)
        ]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Exceptions UI: only Add / Remove / List / Back / Main menu ----
async function renderExceptions(ctx, chatIdStr, userId) {
    const text =
        `🫥 <b>Masked users</b>\n` +
        `It’s not possible to know which user is writing via a channel and if it is an administrator: this block will apply to <u>whoever writes via a channel</u>.\n\n` +
        `🔒 To allow a channel to bypass this, use add button`;

    const rows = [
        [Markup.button.callback("➕ Add", `MU_ADD_${chatIdStr}`), Markup.button.callback("➖ Remove", `MU_REM_${chatIdStr}`)],
        [Markup.button.callback("📋 List", `MU_LIST_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `MASKED_USERS_${chatIdStr}`), Markup.button.callback("🏠 Main menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Prompt helpers -----------------------------------------------
async function promptAdd(ctx, chatIdStr) {
    const text = "Send channel username to add (e.g., @channelusername).";
    await safeEditOrSend(ctx, text, { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `MU_EXC_${chatIdStr}`)]] } });
}
async function promptRemove(ctx, chatIdStr) {
    const text = "Send channel username to remove (e.g., @channelusername).";
    await safeEditOrSend(ctx, text, { reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `MU_EXC_${chatIdStr}`)]] } });
}

// Routes -------------------------------------------------------
module.exports = (bot) => {
    // Open main
    bot.action(/^MASKED_USERS_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderMain(ctx, chatIdStr, userId, ok);
    });

    // On/Off
    bot.action(/^MU_ON_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [mp(chatIdStr, "enabled")]: true } });
        try { await ctx.answerCbQuery("Masked users: ON"); } catch { }
        await renderMain(ctx, chatIdStr, userId, ok);
    });
    bot.action(/^MU_OFF_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [mp(chatIdStr, "enabled")]: false } });
        try { await ctx.answerCbQuery("Masked users: OFF"); } catch { }
        await renderMain(ctx, chatIdStr, userId, ok);
    });

    // Toggle delete
    bot.action(/^MU_DEL_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const cur = !!doc?.settings?.[chatIdStr]?.masked_users?.delete_messages;
        await user_setting_module.updateOne({ user_id: userId }, { $set: { [mp(chatIdStr, "delete_messages")]: !cur } });
        try { await ctx.answerCbQuery(`Delete Messages: ${!cur ? "on" : "off"}`); } catch { }
        await renderMain(ctx, chatIdStr, userId, ok);
    });

    // Exceptions main
    bot.action(/^MU_EXC_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        await renderExceptions(ctx, chatIdStr, userId);
    });

    // Add -> prompt; Remove -> prompt; List -> show list
    bot.action(/^MU_ADD_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "mu_add", chatIdStr } };
        await promptAdd(ctx, chatIdStr);
    });

    bot.action(/^MU_REM_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        ctx.session = { await: { mode: "mu_remove", chatIdStr } };
        await promptRemove(ctx, chatIdStr);
    });

    bot.action(/^MU_LIST_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1]; const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId); if (!ok) return;
        const doc = await user_setting_module.findOne({ user_id: userId }).lean();
        const { whitelist } = getState(doc, chatIdStr);
        const list = whitelist.length ? whitelist.map((u, i) => `${i + 1}. @${u}`).join("\n") : "— No channels allowed yet —";
        await safeEditOrSend(ctx, `Current allowed channels:\n\n${list}`, {
            reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `MU_EXC_${chatIdStr}`)]] }
        });
    });

    // Text capture for Add / Remove
    bot.on("text", async (ctx, next) => {
        const st = ctx.session?.await;
        if (!st || !["mu_add", "mu_remove"].includes(st.mode)) return next && next();

        const { chatIdStr, mode } = st;
        const userId = ctx.from.id;

        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;

        const raw = (ctx.message.text || "").trim();
        const m = /^@?([A-Za-z0-9_]{5,})$/.exec(raw);
        if (!m) {
            const again = mode === "mu_add" ? "MU_ADD" : "MU_REM";
            return safeEditOrSend(ctx, "Invalid username. Send again like @channelusername or Cancel.", {
                reply_markup: { inline_keyboard: [[Markup.button.callback("❌ Cancel", `MU_EXC_${chatIdStr}`)]] }
            });
        }
        const username = m[1];

        if (mode === "mu_add") {
            await user_setting_module.updateOne(
                { user_id: userId },
                { $addToSet: { [mp(chatIdStr, "whitelist")]: username } },
                { upsert: true }
            );
            try { await ctx.answerCbQuery?.("Added"); } catch { }
        } else {
            await user_setting_module.updateOne(
                { user_id: userId },
                { $pull: { [mp(chatIdStr, "whitelist")]: username } }
            );
            try { await ctx.answerCbQuery?.("Removed"); } catch { }
        }

        ctx.session = {};
        await renderExceptions(ctx, chatIdStr, userId);
    });
};
