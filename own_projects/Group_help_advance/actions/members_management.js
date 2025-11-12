const { Markup } = require("telegraf");
const validateOwner = require("../helpers/validateOwner");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const user_setting_module = require("../models/user_settings_module");

// Renders the main Members Management menu
async function renderMembersMenu(ctx, chatIdStr, userId, isOwner) {
    const text =
        `👥 <b>Members Management</b>\n` +
        `From this menu you can manage general actions on group members\n\n`;

    const rows = [
        [
            Markup.button.callback("🔇 Unmute all", `MM_UNMUTE_ALL_${chatIdStr}`),
            Markup.button.callback("🚫 Unban all", `MM_UNBAN_ALL_${chatIdStr}`)
        ],
        [Markup.button.callback("❗ Kick muted/restricted users", `MM_KICK_MUTED_${chatIdStr}`)],
        [Markup.button.callback("💀 Kick deleted accounts", `MM_KICK_DELETED_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Generic confirmation renderer
async function renderConfirm(ctx, chatIdStr, title, body, okAction) {
    const text =
        `👥 <b>${title}</b>\n\n` +
        `${body}\n\n` +
        `Are you sure?`;

    const rows = [
        [Markup.button.callback("✅ Confirm", `${okAction}_${chatIdStr}`)],
        [Markup.button.callback("❌ Cancel", `MEMBERS_MANAGEMENT_${chatIdStr}`)]
    ];
    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
}

// Execute selected action (stub samples — replace with your logic)
async function performBulkAction(ctx, kind, chatIdStr) {
    // TODO: Implement with your storage/logic:
    // - Unmute all: lift chat restrictions for tracked restricted users
    // - Unban all: unban tracked banned users
    // - Kick muted/restricted: remove tracked users with restricted flags
    // - Kick deleted: remove users with is_deleted flag
    // This function currently just acknowledges the click.
    try { await ctx.answerCbQuery(`${kind}: queued`); } catch { }
}

// --- Module routes -------------------------------------------

module.exports = (bot) => {
    // Open Members Management
    bot.action(/^MEMBERS_MANAGEMENT_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderMembersMenu(ctx, chatIdStr, userId, ok);
    });

    // Unmute all -> confirm
    bot.action(/^MM_UNMUTE_ALL_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderConfirm(
            ctx,
            chatIdStr,
            "Unmute all",
            "This will remove restrictions from all tracked restricted users.",
            "MM_UNMUTE_ALL_OK"
        );
    });

    // Unban all -> confirm
    bot.action(/^MM_UNBAN_ALL_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderConfirm(
            ctx,
            chatIdStr,
            "Unban all",
            "This will unban all tracked banned users from the group.",
            "MM_UNBAN_ALL_OK"
        );
    });

    // Kick muted/restricted -> confirm
    bot.action(/^MM_KICK_MUTED_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderConfirm(
            ctx,
            chatIdStr,
            "Kick muted/restricted users",
            "This will remove users currently marked as muted or restricted.",
            "MM_KICK_MUTED_OK"
        );
    });

    // Kick deleted -> confirm
    bot.action(/^MM_KICK_DELETED_(-?\d+)$/, async (ctx) => {
        const chatIdStr = ctx.match[1];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await renderConfirm(
            ctx,
            chatIdStr,
            "Kick deleted accounts",
            "This will remove accounts that are deleted.",
            "MM_KICK_DELETED_OK"
        );
    });

    // OK handlers (execute and return to menu)
    bot.action(/^MM_(UNMUTE_ALL|UNBAN_ALL|KICK_MUTED|KICK_DELETED)_OK_(-?\d+)$/, async (ctx) => {
        const kind = ctx.match[1];
        const chatIdStr = ctx.match[2];
        const userId = ctx.from.id;
        const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
        if (!ok) return;
        await performBulkAction(ctx, kind, chatIdStr);
        await renderMembersMenu(ctx, chatIdStr, userId, ok);
    });
};
