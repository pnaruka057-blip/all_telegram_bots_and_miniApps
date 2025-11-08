const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");
const verifyBotAdminInGroup = require('../helpers/verify_bot_admin_in_group')

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

// HTML escaper
const escapeHTML = (s = "") => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Username and chat id validators
const reUsernameCore = /^[A-Za-z][A-Za-z0-9_]{4,31}$/; // 5–32, first must be a letter
const reAtUsername = /^@([A-Za-z0-9_]{5,32})$/;
const reTmeUser = /^(?:https?:\/\/)?t(?:elegram)?\.me\/([A-Za-z0-9_]{5,32})\/?$/i;
const reChatId = /^-100\d{5,20}$/;
const reTmeC = /^(?:https?:\/\/)?t(?:elegram)?\.me\/c\/(\d{5,20})(?:\/\d+)?$/i;

// Normalize a group identifier to @username or -100<id>
function normalizeGroupIdentifier(s) {
    const x = String(s || "").trim();

    if (reChatId.test(x)) return x;

    const mc = x.match(reTmeC);
    if (mc) return `-100${mc[1]}`;

    const mu = x.match(reAtUsername);
    if (mu) {
        if (!/^[A-Za-z]/.test(mu[1])) return null;
        return `@${mu[1]}`;
    }

    const mt = x.match(reTmeUser);
    if (mt) {
        if (!/^[A-Za-z]/.test(mt[1])) return null;
        return `@${mt[1]}`;
    }

    // plain username without @
    if (reUsernameCore.test(x)) return `@${x}`;

    return null;
}

// render main @admin menu
async function renderAtAdminMenu(ctx, chatIdStr, userId) {
    ctx.session = {};
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const atadmin = userDoc?.settings?.[chatIdStr]?.admin_sos || {};

    const sendTo = atadmin.send_to || "nobody"; // "nobody"|"founder"|"staff"
    const tagFounder = getBool(atadmin, "tag_founder", false);
    const taggedAdmins = Array.isArray(atadmin.tagged_admins) ? atadmin.tagged_admins : [];

    const staffGroupLink = userDoc?.settings?.[chatIdStr]?.staff_group || null;

    const sendToLineBase = (() => {
        if (sendTo === "nobody") return "Send to: ✖️ Nobody";
        if (sendTo === "founder") return "Send to: 👑 Founder";
        if (sendTo === "staff") {
            return `Send to: 👥 Staff Group${staffGroupLink ? "" : "\n\n❗️ If a Staff Group isn't set, the message will not be sent to anyone."}`;
        }
        return "Send to: ✖️ Nobody";
    })();

    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;

    const text =
        `🆘 <b>Admin command</b>\n\n` +
        `<code>@admin</code> (or <code>/report</code>) is a command available to users to attract the attention of the group's staff, for example if some other user is not respecting the group's rules.\n\n` +
        `From this menu set where user reports should go and/or whether to tag staff members directly.\n\n` +
        `⚠️ The <code>@admin</code> command DOES NOT work when used by Admins or Mods.\n\n` +
        `${sendToLineBase}\n\n` +
        (sendTo === "staff" && staffGroupLink ? `Staff group: ${escapeHTML(staffGroupLink)}\n\n` : "") +
        `<i>Use buttons below to config admin commend setting for <b>${isOwner?.title}</b>.</i>`;

    // keyboard
    const rows = [
        [
            Markup.button.callback("✖️ Nobody", `SET_ATADMIN_SEND_NOBODY_${chatIdStr}`),
            Markup.button.callback("👑 Founder", `SET_ATADMIN_SEND_FOUNDER_${chatIdStr}`)
        ],
        [
            // Do not immediately enable "send_to=staff"; open flow first
            Markup.button.callback("👥 Staff Group", `OPEN_SET_STAFF_GROUP_${chatIdStr}`)
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

    // Add select-all / deselect-all row
    rows.unshift([
        Markup.button.callback("Select All", `ATADMIN_TAGADMINS_SELECTALL_${chatIdStr}`),
        Markup.button.callback("Deselect All", `ATADMIN_TAGADMINS_DESELECTALL_${chatIdStr}`)
    ]);

    // add done/back buttons
    rows.push([Markup.button.callback("⬅️ Back", `SET_ATADMIN_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]);

    const text =
        `Select which admins should be tagged when <code>@admin</code> is used.\n\n` +
        `Tap an admin to toggle tagging. Selected admins show ✅.\n\n` +
        `Selected count: ${taggedAdmins.length}`;

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// Advanced settings renderer 
async function renderAtAdminAdvancedMenu(ctx, chatIdStr, userId) {
    const isOwner = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
    if (!isOwner) return;
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const adminSos = userDoc?.settings?.[chatIdStr]?.admin_sos || {};

    const onlyInReply = !!adminSos.only_in_reply;
    const reasonRequired = !!adminSos.reason_required;
    const deleteIfResolved = !!adminSos.delete_if_resolved;
    const deleteInStaffIfResolved = !!adminSos.delete_in_staff_if_resolved;

    const text =
        `🛠️ <b>Advanced admin settings</b>\n\n` +
        `These options control additional behaviour of the <code>@admin</code> / <code>/report</code> command.\n\n` +
        `📎 <b>Only in reply:</b> The command <code>@admin</code> will only be usable by users if sent in reply to another user's message.\n` +
        `- Status: ${onlyInReply ? "On ✅" : "Off ❌"}\n\n` +
        `📝 <b>Reason required:</b> The <code>@admin</code> command will only be usable if the message also includes a reason for the report.\n` +
        `- Status: ${reasonRequired ? "On ✅" : "Off ❌"}\n\n` +
        `🗑️ <b>Delete if resolved:</b> If a report is marked resolved, both the reporter's message and the bot's message will be deleted from the group.\n` +
        `- Status: ${deleteIfResolved ? "On ✅" : "Off ❌"}\n\n` +
        `🗂️ <b>Delete in staff group if resolved:</b> If a report is marked resolved, the report message will be deleted in the staff group as well.\n` +
        `- Status: ${deleteInStaffIfResolved ? "On ✅" : "Off ❌"}\n\n` +
        `<i>Use buttons below to config admin commend setting for <b>${isOwner?.title}</b>.</i>`;

    const rows = [
        [Markup.button.callback(`${onlyInReply ? "📎 Only in reply ✅" : "📎 Only in reply ✖️"}`, `TOGGLE_ATADMIN_ADV_ONLYREPLY_${chatIdStr}`)],
        [Markup.button.callback(`${reasonRequired ? "📝 Reason required ✅" : "📝 Reason required ✖️"}`, `TOGGLE_ATADMIN_ADV_REASONREQ_${chatIdStr}`)],
        [Markup.button.callback(`${deleteIfResolved ? "🗑️ Delete if resolved ✅" : "🗑️ Delete if resolved ✖️"}`, `TOGGLE_ATADMIN_ADV_DELETEIF_${chatIdStr}`)],
        [Markup.button.callback(`${deleteInStaffIfResolved ? "🗂️ Delete in staff group if resolved ✅" : "🗂️ Delete in staff group if resolved ✖️"}`, `TOGGLE_ATADMIN_ADV_DELETESTAFFIF_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_ATADMIN_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// Renders the "Set Staff Group" prompt
async function renderSetStaffGroupPrompt(ctx, chatIdStr, userId) {
    const text =
        `👥 <b>Set Staff Group</b>\n\n` +
        `Please send one of the following for your staff group:\n` +
        `- <code>@username</code>\n` +
        `- <code>t.me/username</code>\n` +
        `- <code>-100&lt;chat_id&gt;</code>\n\n` +
        `After sending, grant the bot admin in that group, then press Done.\n` +
        `You can Cancel at any time.`;

    const rows = [
        [Markup.button.callback("🗑 Remove current", `STAFF_GROUP_REMOVE_${chatIdStr}`)],
        [Markup.button.callback("❌ Cancel", `CANCEL_SET_STAFF_GROUP_${chatIdStr}`)]
    ];

    const message_id = await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } }, true);
    ctx.session.last_set_staff_group_message_id = message_id
}

// Renders the review after staff group candidate is captured
async function renderStaffGroupReview(ctx, chatIdStr, userId, candidate) {
    if (ctx?.session?.last_set_staff_group_message_id) {
        try { await ctx.deleteMessage(ctx.session.last_set_staff_group_message_id); } catch (_) { }
    }
    delete ctx.session.awaitingStaffGroupInput;
    const text =
        `Staff group: <b>${escapeHTML(candidate)}</b>\n\n` +
        `Click <b>Verify Now</b> if the bot is an admin in that group.`;

    const rows = [
        [
            Markup.button.callback("✅ Verify Now", `STAFF_GROUP_DONE_${chatIdStr}`),
        ],
        [
            Markup.button.callback("❌ Cancel", `CANCEL_SET_STAFF_GROUP_${chatIdStr}`),
            Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)
        ]
    ];

    await safeEditOrSend(ctx, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
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
                    $set: { [`settings.${chatIdStr}.admin_sos.send_to`]: "nobody" }
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
                    $set: { [`settings.${chatIdStr}.admin_sos.send_to`]: "founder" }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("Send to: Founder");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ATADMIN_SEND_FOUNDER error:", err);
        }
    });

    // Open Set Staff Group flow (do not immediately set send_to=staff)
    bot.action(/^OPEN_SET_STAFF_GROUP_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            // Mark session to capture next text as staff group candidate
            ctx.session = ctx.session || {};
            ctx.session.awaitingStaffGroupInput = { chatIdStr, userId };

            await renderSetStaffGroupPrompt(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("OPEN_SET_STAFF_GROUP error:", err);
        }
    });

    // Cancel staff group setting
    bot.action(/^CANCEL_SET_STAFF_GROUP_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            if (ctx.session?.awaitingStaffGroupInput) delete ctx.session.awaitingStaffGroupInput;
            if (ctx.session?.awaitingStaffGroupVerify) delete ctx.session.awaitingStaffGroupVerify;
            await ctx.answerCbQuery("Cancelled.");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("CANCEL_SET_STAFF_GROUP error:", err);
        }
    });

    // Remove current staff group
    bot.action(/^STAFF_GROUP_REMOVE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $unset: { [`settings.${chatIdStr}.staff_group`]: "" },
                    $set: { [`settings.${chatIdStr}.admin_sos.send_to`]: "nobody" }
                }
            );

            await ctx.answerCbQuery("Removed current staff group.");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("STAFF_GROUP_REMOVE error:", err);
        }
    });

    // Done: verify bot admin in candidate and save + set send_to=staff on success
    bot.action(/^STAFF_GROUP_DONE_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const candidate = ctx.session?.awaitingStaffGroupVerify?.candidate;
            if (!candidate) {
                await ctx.answerCbQuery("No staff group provided yet.");
                return;
            }

            const isAdmin = await verifyBotAdminInGroup(ctx, candidate);

            if (!isAdmin) {
                await ctx.answerCbQuery(
                    "❌ The bot is not an admin. Please add the bot as an admin there and press Done again.",
                    { show_alert: true }
                );
                return;
            }

            // Save staff group and enable send_to=staff
            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: {
                        [`settings.${chatIdStr}.staff_group`]: candidate,
                        [`settings.${chatIdStr}.admin_sos.send_to`]: "staff",
                    }
                },
                { upsert: true }
            );

            delete ctx.session.awaitingStaffGroupInput;
            delete ctx.session.awaitingStaffGroupVerify;

            await ctx.answerCbQuery(`✅ Staff group set: ${escapeHTML(candidate)}`);

            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("STAFF_GROUP_DONE error:", err);
        }
    });

    // Set send to Staff Group (legacy direct action is replaced by guided flow)
    bot.action(/^SET_ATADMIN_SEND_STAFF_(-?\d+)$/, async (ctx) => {
        // Retained for backward compatibility if used elsewhere; redirect to OPEN_SET_STAFF_GROUP
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await ctx.answerCbQuery("Use Staff Group button to set a group first.");
            await renderAtAdminMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_ATADMIN_SEND_STAFF legacy error:", err);
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

            await ctx.answerCbQuery("Updated admin selection");
            await renderAdminsSelectionMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_ATADMIN_TAGADMIN error:", err);
        }
    });

    // Select All admins
    bot.action(/^ATADMIN_TAGADMINS_SELECTALL_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const chatAdmins = await ctx.telegram.getChatAdministrators(chatId);
            const admins = (chatAdmins || []).filter(a => a.user && !a.user.is_bot);
            const allIds = admins.map(a => String(a.user.id));

            await user_setting_module.updateOne(
                { user_id: userId },
                {
                    $setOnInsert: { user_id: userId },
                    $set: { [`settings.${chatIdStr}.admin_sos.tagged_admins`]: allIds }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("All admins selected");
            await renderAdminsSelectionMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ATADMIN_TAGADMINS_SELECTALL error:", err);
        }
    });

    // Deselect All admins
    bot.action(/^ATADMIN_TAGADMINS_DESELECTALL_(-?\d+)$/, async (ctx) => {
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
                    $set: { [`settings.${chatIdStr}.admin_sos.tagged_admins`]: [] }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery("All admins deselected");
            await renderAdminsSelectionMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("ATADMIN_TAGADMINS_DESELECTALL error:", err);
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

    // Capture text for staff group in the OPEN_SET_STAFF_GROUP flow
    bot.on("text", async (ctx, next) => {
        try {
            const sess = ctx.session || {};
            if (!sess.awaitingStaffGroupInput && !sess.awaitingStaffGroupVerify) return next();

            // Determine which chat is being configured
            const chatIdStr = sess.awaitingStaffGroupInput?.chatIdStr || sess.awaitingStaffGroupVerify?.chatIdStr;
            const userId = sess.awaitingStaffGroupInput?.userId || sess.awaitingStaffGroupVerify?.userId;
            if (!chatIdStr || !userId) return next();

            // Validate ownership on each input
            const ok = await validateOwner(ctx, Number(chatIdStr), chatIdStr, userId);
            if (!ok) return;

            const raw = (ctx.message.text || "").trim();
            const normalized = normalizeGroupIdentifier(raw);
            if (!normalized) {
                await safeEditOrSend(
                    ctx,
                    "❌ Invalid input. Send one of:\n- <code>@username</code>\n- <code>t.me/username</code>\n- <code>-100&lt;chat_id&gt;</code>\nTry again",
                    { parse_mode: "HTML", disable_web_page_preview: true }
                );
                return;
            }

            // Save candidate in session, ask to Done or Cancel
            ctx.session.awaitingStaffGroupVerify = { chatIdStr, userId, candidate: normalized };
            delete ctx.session.awaitingStaffGroupInput;

            await renderStaffGroupReview(ctx, chatIdStr, userId, normalized);
        } catch (err) {
            console.error("staff group input error:", err);
            return next();
        }
    });
};
