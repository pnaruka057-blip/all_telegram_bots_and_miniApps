const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const validateOwner = require("../helpers/validateOwner");
const user_setting_module = require("../models/user_settings_module");

// helper to get a safe boolean from nested settings
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

// main render of the compact checks menu (first image)
async function renderChecksMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const checks = userDoc?.settings?.[chatIdStr]?.checks || {};

    // obligations
    const ob = checks.obligations || {};
    const blocks = checks.name_blocks || {};

    const statusOn = (v) => (v ? "On" : "Off");

    const text =
        `<b>OBLIGATION OF...</b>\n` +
        `• Surname: ${statusOn(ob.surname)}\n` +
        `• Username: ${statusOn(ob.username)}\n` +
        `• Profile picture: ${statusOn(ob.profile_picture)}\n` +
        `• Channel obligation: ${statusOn(ob.channel_obligation)}\n` +
        `• Obligation to add: ${statusOn(ob.obligation_to_add)}\n\n` +

        `<b>BLOCK...</b>\n` +
        `• Arabic name: ${statusOn(blocks.arabic)}\n` +
        `• Chinese name: ${statusOn(blocks.chinese)}\n` +
        `• Russian name: ${statusOn(blocks.russian)}\n` +
        `• Spam name: ${statusOn(blocks.spam)}\n\n` +

        `🚪 <b>Check at the join</b>\n` +
        `If active, the bot will check for obligations and blocks even when users join the group, as well as when sending a message.\n` +
        `Status: ${statusOn(checks.check_at_join)}\n\n` +

        `🗑 <b>Delete Messages</b>\n` +
        `If active, the bot will delete messages sent by users who do not comply with the obligations/blocks.\n` +
        `Status: ${statusOn(checks.delete_messages)}\n\n`;

    const checkAtJoin = getBool(checks, "check_at_join", false);
    const deleteMessages = getBool(checks, "delete_messages", false);

    const rows = [
        // top navigation: obligations / name blocks
        [
            Markup.button.callback("OBLIGATIONS", `SET_OBLIGATIONS_${chatIdStr}`),
            Markup.button.callback("NAME BLOCKS", `SET_NAME_BLOCKS_${chatIdStr}`)
        ],
        // toggles shown as separate rows like in image
        [Markup.button.callback(`${checkAtJoin ? "📥 Check at the join ✓" : "📥 Check at the join ✗"}`, `TOGGLE_CHECK_JOIN_${chatIdStr}`)],
        [Markup.button.callback(`${deleteMessages ? "🗑️ Delete Messages ✓" : "🗑️ Delete Messages ✗"}`, `TOGGLE_DELETE_MESSAGES_${chatIdStr}`)],
        // back
        [Markup.button.callback("⬅️ Back", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text + `Status: ${checkAtJoin ? "Active ✅" : "Inactive ❌"}`, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// render obligations expanded menu (second image style) — with text summary
async function renderObligationsMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const ob = userDoc?.settings?.[chatIdStr]?.checks?.obligations || {};

    const statusOn = (v) => (v ? "On ✅" : "Off ❌");

    const text =
        `🔧 <b>Obligations</b>\n\n` +
        `• Surname: ${statusOn(ob.surname)}\n` +
        `• Username: ${statusOn(ob.username)}\n` +
        `• Profile picture: ${statusOn(ob.profile_picture)}\n` +
        `• Channel obligation: ${statusOn(ob.channel_obligation)}\n` +
        `• Obligation to add: ${statusOn(ob.obligation_to_add)}\n\n` +
        `Toggle each obligation below:`;

    const rows = [
        [Markup.button.callback(`${ob.surname ? "👤 Obligation Surname ✓" : "👤 Obligation Surname ✗"}`, `TOGGLE_OBL_Surname_${chatIdStr}`)],
        [Markup.button.callback(`${ob.username ? "🌐 Username Obligation ✓" : "🌐 Username Obligation ✗"}`, `TOGGLE_OBL_Username_${chatIdStr}`)],
        [Markup.button.callback(`${ob.profile_picture ? "🖼️ Profile Picture Obligation ✓" : "🖼️ Profile Picture Obligation ✗"}`, `TOGGLE_OBL_ProfilePic_${chatIdStr}`)],
        [Markup.button.callback(`${ob.obligation_to_add ? "➕ Obligation to add ✓" : "➕ Obligation to add ✗"}`, `TOGGLE_OBL_Add_${chatIdStr}`)],
        [Markup.button.callback(`${ob.channel_obligation ? "📣 Channel obligation ✓" : "📣 Channel obligation ✗"}`, `TOGGLE_OBL_Channel_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_CHECKS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

// render name blocks expanded menu — with text summary and statuses
async function renderNameBlocksMenu(ctx, chatIdStr, userId) {
    const userDoc = await user_setting_module.findOne({ user_id: userId }).lean();
    const blocks = userDoc?.settings?.[chatIdStr]?.checks?.name_blocks || {};

    const statusOn = (v) => (v ? "On ✅" : "Off ❌");

    const text =
        `🚫 <b>Name Blocks</b>\n\n` +
        `• Arabic name: ${statusOn(blocks.arabic)}\n` +
        `• Chinese name: ${statusOn(blocks.chinese)}\n` +
        `• Russian name: ${statusOn(blocks.russian)}\n` +
        `• Spam name: ${statusOn(blocks.spam)}\n\n` +
        `Toggle each block below:`;

    const rows = [
        [Markup.button.callback(`${blocks.arabic ? "🈶 Arabic name ✓" : "🈚 Arabic name ✗"}`, `TOGGLE_BLK_Arabic_${chatIdStr}`)],
        [Markup.button.callback(`${blocks.chinese ? "中 Chinese name ✓" : "中 Chinese name ✗"}`, `TOGGLE_BLK_Chinese_${chatIdStr}`)],
        [Markup.button.callback(`${blocks.russian ? "RU Russian Name ✓" : "RU Russian Name ✗"}`, `TOGGLE_BLK_Russian_${chatIdStr}`)],
        [Markup.button.callback(`${blocks.spam ? "🚩 Spam name ✓" : "🚩 Spam name ✗"}`, `TOGGLE_BLK_Spam_${chatIdStr}`)],
        [Markup.button.callback("⬅️ Back", `SET_CHECKS_${chatIdStr}`), Markup.button.callback("🏠 Main Menu", `GROUP_SETTINGS_${chatIdStr}`)]
    ];

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: rows }
    });
}

module.exports = (bot) => {
    // Open main checks menu
    bot.action(/^SET_CHECKS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderChecksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_CHECKS error:", err);
        }
    });

    // Toggles: Check at join
    bot.action(/^TOGGLE_CHECK_JOIN_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.check_at_join;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.check_at_join`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Check at join: ${newVal ? "On" : "Off"}`);
            await renderChecksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_CHECK_JOIN error:", err);
        }
    });

    // Toggles: Delete messages
    bot.action(/^TOGGLE_DELETE_MESSAGES_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.delete_messages;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.delete_messages`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Delete messages: ${newVal ? "On" : "Off"}`);
            await renderChecksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_DELETE_MESSAGES error:", err);
        }
    });

    // Open obligations expanded
    bot.action(/^SET_OBLIGATIONS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderObligationsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_OBLIGATIONS error:", err);
        }
    });

    // Open name blocks expanded
    bot.action(/^SET_NAME_BLOCKS_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("SET_NAME_BLOCKS error:", err);
        }
    });

    // --- obligation toggles ---
    bot.action(/^TOGGLE_OBL_Surname_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.obligations?.surname;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.obligations.surname`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Surname obligation: ${newVal ? "On" : "Off"}`);
            await renderObligationsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_OBL_Surname error:", err);
        }
    });

    bot.action(/^TOGGLE_OBL_Username_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.obligations?.username;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.obligations.username`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Username obligation: ${newVal ? "On" : "Off"}`);
            await renderObligationsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_OBL_Username error:", err);
        }
    });

    bot.action(/^TOGGLE_OBL_ProfilePic_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.obligations?.profile_picture;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.obligations.profile_picture`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Profile picture obligation: ${newVal ? "On" : "Off"}`);
            await renderObligationsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_OBL_ProfilePic error:", err);
        }
    });

    bot.action(/^TOGGLE_OBL_Add_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.obligations?.obligation_to_add;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.obligations.obligation_to_add`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Obligation to add: ${newVal ? "On" : "Off"}`);
            await renderObligationsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_OBL_Add error:", err);
        }
    });

    bot.action(/^TOGGLE_OBL_Channel_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const userId = ctx.from.id;
            const chatId = Number(chatIdStr);

            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.obligations?.channel_obligation;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.obligations.channel_obligation`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Channel obligation: ${newVal ? "On" : "Off"}`);
            await renderObligationsMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_OBL_Channel error:", err);
        }
    });

    // --- name block toggles ---
    bot.action(/^TOGGLE_BLK_Arabic_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.name_blocks?.arabic;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.name_blocks.arabic`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Arabic name block: ${newVal ? "On" : "Off"}`);
            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_BLK_Arabic error:", err);
        }
    });

    bot.action(/^TOGGLE_BLK_Chinese_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.name_blocks?.chinese;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.name_blocks.chinese`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Chinese name block: ${newVal ? "On" : "Off"}`);
            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_BLK_Chinese error:", err);
        }
    });

    bot.action(/^TOGGLE_BLK_Russian_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.name_blocks?.russian;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.name_blocks.russian`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Russian name block: ${newVal ? "On" : "Off"}`);
            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_BLK_Russian error:", err);
        }
    });

    bot.action(/^TOGGLE_BLK_Spam_(-?\d+)$/, async (ctx) => {
        try {
            const chatIdStr = ctx.match[1];
            const chatId = Number(chatIdStr);
            const userId = ctx.from.id;
            const ok = await validateOwner(ctx, chatId, chatIdStr, userId);
            if (!ok) return;

            const userIdKey = userId;
            const userDoc = await user_setting_module.findOne({ user_id: userIdKey }).lean();
            const cur = !!userDoc?.settings?.[chatIdStr]?.checks?.name_blocks?.spam;
            const newVal = !cur;

            await user_setting_module.updateOne(
                { user_id: userIdKey },
                {
                    $setOnInsert: { user_id: userIdKey },
                    $set: { [`settings.${chatIdStr}.checks.name_blocks.spam`]: newVal }
                },
                { upsert: true }
            );

            await ctx.answerCbQuery(`Spam name block: ${newVal ? "On" : "Off"}`);
            await renderNameBlocksMenu(ctx, chatIdStr, userId);
        } catch (err) {
            console.error("TOGGLE_BLK_Spam error:", err);
        }
    });
};
