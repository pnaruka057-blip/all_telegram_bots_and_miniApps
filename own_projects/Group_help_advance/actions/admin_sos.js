const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// helper: safe bool getter
function getBool(obj, path, def = false) {
    try {
        const keys = path.split(".");
        let cur = obj;
        for (const k of keys) {
            if (!cur) return def;
            cur = cur[k];
        }
        return !!cur;
    } catch {
        return def;
    }
}

// render main @admin menu
async function renderAtAdminMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const atadmin = userDoc?.settings?.[chatIdStr]?.admin_sos || {};

    const sendTo = atadmin.send_to || "nobody"; // "nobody"|"founder"|"staff"
    const active = getBool(atadmin, "active", true);
    const tagFounder = getBool(atadmin, "tag_founder", false);
    const taggedAdmins = Array.isArray(atadmin.tagged_admins) ? atadmin.tagged_admins : [];

    const staffGroupLink = userDoc?.settings?.[chatIdStr]?.staff_group || null;

    const statusLine = `Status: ${active ? "Active" : "Inactive"}`;
    const sendToLineBase = (() => {
        if (sendTo === "nobody") return "Send to: ✖️ Nobody";
        if (sendTo === "founder") return "Send to: 👑 Founder";
        if (sendTo === "staff") {
            return `Send to: 👥 Staff Group${staffGroupLink ? "" : "\n\n❗️ If a Staff Group isn't set, the message will not be sent to anyone."}`;
        }
        return "Send to: ✖️ Nobody";
    })();

    const text =
        `🆘 <b>@admin</b> command\n\n` +
        `@admin (or /report) is a command available to users to attract the attention of the group's staff, for example if some other user is not respecting the group's rules.\n\n` +
        `From this menu you can set where you want the reports made by users to be sent and/or whether to tag some staff members directly.\n\n` +
        `⚠️ The @admin command DOES NOT work when used by Admins or Mods.\n\n` +
        `${statusLine}\n` +
        `${sendToLineBase}\n\n` +
        (sendTo === "staff" && staffGroupLink ? `Staff group: ${staffGroupLink}\n\n` : "");

    // keyboard
    const rows = [
        [
            Markup.button.callback("✖️ Nobody", `SET_ATADMIN_SEND_NOBODY_${chatIdStr}`),
            Markup.button.callback("👑 Founder", `SET_ATADMIN_SEND_FOUNDER_${chatIdStr}`)
        ],
        [
            Markup.button.callback("👥 Staff Group", `SET_ATADMIN_SEND_STAFF_${chatIdStr}`)
        ],
        [
            Markup.button.callback(`${tagFounder ? "🔔 Tag Founder ✅" : "🔔 Tag Founder ✖️"}`, `TOGGLE_ATADMIN_TAGFOUNDER_${chatIdStr}`)
        ],
        [
            Markup.button.callback(`${taggedAdmins.length ? `🔔 Tag Admins (${taggedAdmins.length}) ✅` : "🔔 Tag Admins ✖️"}`, `OPEN_ATADMIN_TAG_ADMINS_${chatIdStr}`)
        ],
        [
            Markup.button.callback("🛠 Advanced settings", `ATADMIN_ADVANCED_${chatIdStr}`)
        ],
        [
            Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)
        ]
    ];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// render admin selection menu (list of chat admins)
async function renderAdminsSelectionMenu(ctx, chatIdStr, userId) {
    const chatId = Number(chatIdStr);
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const atadmin = userDoc?.settings?.[chatIdStr]?.admin_sos || {};
    const taggedAdmins = Array.isArray(atadmin.tagged_admins) ? atadmin.tagged_admins : [];

    let admins = [];
    try {
        const chatAdmins = await ctx.telegram.getChatAdministrators(chatId);
        admins = (chatAdmins || []).filter(a => a.user && !a.user.is_bot);
    } catch (err) {
        console.error("Failed to fetch chat administrators:", err);
        await ctx.answerCbQuery("Unable to fetch admins (bot might not be in the group or lacks permissions).");
        return renderAtAdminMenu(ctx, chatIdStr, userId);
    }

    if (admins.length === 0) {
        await safeEditOrSend(ctx, "No admins found in this chat.", {
            reply_markup: { inline_keyboard: [[Markup.button.callback("⬅️ Back", `SET_ATADMIN_${chatIdStr}`)]] }
        });
        return;
    }

    const rows = admins.map(admin => {
        const u = admin.user;
        const displayName = [u.first_name || "", u.last_name || ""].filter(Boolean).join(" ") || u.username || `(${u.id})`;
        const selected = taggedAdmins.includes(String(u.id)) || taggedAdmins.includes(u.id);
        const label = `${displayName} ${selected ? "✅" : ""}`;
        return [Markup.button.callback(label, `TOGGLE_ATADMIN_TAGADMIN_${chatIdStr}_${u.id}`)];
    });

    // add done/back buttons
    rows.push([Markup.button.callback("✅ Done", `SET_ATADMIN_${chatIdStr}`), Markup.button.callback("⬅️ Back", `SET_ATADMIN_${chatIdStr}`)]);

    const text =
        `Select which admins should be tagged when @admin is used.\n\n` +
        `Click an admin to toggle tagging. Selected admins will show ✅.\n\n` +
        `Selected count: ${taggedAdmins.length}`;

    await safeEditOrSend(ctx, text, {
        reply_markup: { inline_keyboard: rows }
    });
}

// Advanced settings renderer 
async function renderAtAdminAdvancedMenu(ctx, chatIdStr, userId) {
    const chatId = Number(chatIdStr);
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const adminSos = userDoc?.settings?.[chatIdStr]?.admin_sos || {};

    const onlyInReply = !!adminSos.only_in_reply;
    const reasonRequired = !!adminSos.reason_required;
    const deleteIfResolved = !!adminSos.delete_if_resolved;
    const deleteInStaffIfResolved = !!adminSos.delete_in_staff_if_resolved;

    const text =
        `🛠️ <b>Advanced @admin settings</b>\n\n` +
        `These options control additional behaviour of the @admin / /report command.\n\n` +
        `📎 <b>Only in reply:</b> The command @admin will only be usable by users if sent in reply to another user's message.\n` +
        `- Status: ${onlyInReply ? "On ✅" : "Off ❌"}\n\n` +
        `📝 <b>Reason required:</b> The @admin command will only be usable if the message also includes a reason for the report.\n` +
        `- Status: ${reasonRequired ? "On ✅" : "Off ❌"}\n\n` +
        `🗑️ <b>Delete if resolved:</b> If a report is marked resolved, both the reporter's message and the bot's message will be deleted from the group.\n` +
        `- Status: ${deleteIfResolved ? "On ✅" : "Off ❌"}\n\n` +
        `🗂️ <b>Delete in staff group if resolved:</b> If a report is marked resolved, the report message will be deleted in the staff group as well.\n` +
        `- Status: ${deleteInStaffIfResolved ? "On ✅" : "Off ❌"}\n\n`;

    const rows = [
        [Markup.button.callback(`${onlyInReply ? "📎 Only in reply ✅" : "📎 Only in reply ✖️"}`, `TOGGLE_ATADMIN_ADV_ONLYREPLY_${chatIdStr}`)],
        [Markup.button.callback(`${reasonRequired ? "📝 Reason required ✅" : "📝 Reason required ✖️"}`, `TOGGLE_ATADMIN_ADV_REASONREQ_${chatIdStr}`)],
        [Markup.button.callback(`${deleteIfResolved ? "🗑️ Delete if resolved ✅" : "🗑️ Delete if resolved ✖️"}`, `TOGGLE_ATADMIN_ADV_DELETEIF_${chatIdStr}`)],
        [Markup.button.callback(`${deleteInStaffIfResolved ? "🗂️ Delete in staff group if resolved ✅" : "🗂️ Delete in staff group if resolved ✖️"}`, `TOGGLE_ATADMIN_ADV_DELETESTAFFIF_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_ATADMIN_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// module export
module.exports = (bot) => {
    // Open main atadmin menu
    bot.action(/^SET_ATADMIN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ATADMIN error:", err);
        }
    });

    // Set send to Nobody
    bot.action(/^SET_ATADMIN_SEND_NOBODY_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.send_to`]: "nobody", [`settings.${chatIdStr}.admin_sos.active`]: true }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("Send to: Nobody");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ATADMIN_SEND_NOBODY error:", err);
        }
    });

    // Set send to Founder
    bot.action(/^SET_ATADMIN_SEND_FOUNDER_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.send_to`]: "founder", [`settings.${chatIdStr}.admin_sos.active`]: true }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("Send to: Founder");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ATADMIN_SEND_FOUNDER error:", err);
        }
    });

    // Set send to Staff Group
    bot.action(/^SET_ATADMIN_SEND_STAFF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.send_to`]: "staff", [`settings.${chatIdStr}.admin_sos.active`]: true }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("Send to: Staff Group");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ATADMIN_SEND_STAFF error:", err);
        }
    });

    // Toggle Tag Founder
    bot.action(/^TOGGLE_ATADMIN_TAGFOUNDER_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.admin_sos?.tag_founder;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.tag_founder`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Tag Founder: ${newVal ? "On" : "Off"}`);
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_TAGFOUNDER error:", err);
        }
    });

    // Open Tag Admins selection
    bot.action(/^OPEN_ATADMIN_TAG_ADMINS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderAdminsSelectionMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("OPEN_ATADMIN_TAG_ADMINS error:", err);
        }
    });

    // Toggle a single admin selection
    bot.action(/^TOGGLE_ATADMIN_TAGADMIN_(-?\d+)_([0-9]+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const adminIdStr = ctx.match[2]; // string of admin id
            const adminId = adminIdStr;
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const taggedAdmins = new Set((userDoc?.settings?.[chatIdStr]?.admin_sos?.tagged_admins || []).map(String));

            if (taggedAdmins.has(String(adminId))) {
                taggedAdmins.delete(String(adminId));
            } else {
                taggedAdmins.add(String(adminId));
            }

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.tagged_admins`]: Array.from(taggedAdmins) }
                },
                { upsert: true }
            );

            // feedback and re-render admin selection
            await ctx.answerCbQuery("Updated admin selection");
            await renderAdminsSelectionMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_TAGADMIN error:", err);
        }
    });

    // Show advanced settings
    bot.action(/^ATADMIN_ADVANCED_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderAtAdminAdvancedMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ATADMIN_ADVANCED error:", err);
        }
    });

    // Toggle Only in reply
    bot.action(/^TOGGLE_ATADMIN_ADV_ONLYREPLY_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.admin_sos?.only_in_reply;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.only_in_reply`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Only in reply: ${newVal ? "On" : "Off"}`);
            await renderAtAdminAdvancedMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_ADV_ONLYREPLY error:", err);
        }
    });

    // Toggle Reason required
    bot.action(/^TOGGLE_ATADMIN_ADV_REASONREQ_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.admin_sos?.reason_required;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.reason_required`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Reason required: ${newVal ? "On" : "Off"}`);
            await renderAtAdminAdvancedMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_ADV_REASONREQ error:", err);
        }
    });

    // Toggle Delete if resolved
    bot.action(/^TOGGLE_ATADMIN_ADV_DELETEIF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.admin_sos?.delete_if_resolved;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.delete_if_resolved`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete if resolved: ${newVal ? "On" : "Off"}`);
            await renderAtAdminAdvancedMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_ADV_DELETEIF error:", err);
        }
    });

    // Toggle Delete in staff group if resolved
    bot.action(/^TOGGLE_ATADMIN_ADV_DELETESTAFFIF_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.admin_sos?.delete_in_staff_if_resolved;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.delete_in_staff_if_resolved`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete in staff group if resolved: ${newVal ? "On" : "Off"}`);
            await renderAtAdminAdvancedMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_ADV_DELETESTAFFIF error:", err);
        }
    });
};
