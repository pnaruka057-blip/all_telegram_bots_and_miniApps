const { Markup } = require("telegraf");
const escapeMarkdownV2 = require("../helpers/escapeMarkdownV2");
const redis = require("../../../globle_helper/redisConfig");
const mini_app_link = process.env.GLOBLE_DOMAIN
const movies_hub_token = process.env.MOVIES_HUB_TOKEN

// Helper: save message to Redis with expiry (3 minutes)
async function saveMessage(namespace, chatId, messageId) {
    const key = `${namespace}:${chatId}`;
    const data = await redis.get(key);
    let arr = [];

    if (data) {
        try {
            arr = JSON.parse(data);
            if (!Array.isArray(arr)) arr = [];
        } catch {
            arr = [];
        }
    }

    arr.push({
        chatId,
        messageId,
        expireAt: Date.now() + 3 * 60 * 1000 // 3 minutes
    });

    await redis.set(key, JSON.stringify(arr));
}

module.exports = async (ctx) => {
    const userMessage = `*Hi ${escapeMarkdownV2(ctx.from.first_name)}* 👋\n\n🎉 *Welcome to your ultimate entertainment hub\\!* Here, you can find your favorite 🎬 *Movies* and 📺 *Shows* absolutely *FREE* — no hidden charges, no premium, just pure content love\\. ❤️\n\n👇 Use the buttons below to get started:`;

    const miniAppUrl = `${mini_app_link}/${movies_hub_token}/movies-hub?userId=${ctx.from.id}`;

    const keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp("🎬 Get Movies", miniAppUrl)], // ✅ Mini App button
        [Markup.button.callback("🔍 Find Movies", "FIND_MOVIES"), Markup.button.callback("📺 Find Shows", "FIND_SHOWS")],
        // [Markup.button.callback("📘 Help Guide", "HELP_GUIDE")],
        [Markup.button.url("📢 Join Official Channel", `https://t.me/${process.env.CHANNEL_ID_MOVIEHUB}`)],
        [Markup.button.callback("🌐 Change Language", "CHANGE_LANGUAGE")],
    ]);

    try {
        ctx.session = {};
        const sentMsg = await ctx.editMessageText(userMessage, { parse_mode: "MarkdownV2", ...keyboard });

        // save to redis under main_menu:<chatId> as an array (allows multiple messages per chat)
        await saveMessage("main_menu", ctx.chat.id, sentMsg.message_id);
    } catch (error) {
        const sentMsg = await ctx.reply(userMessage, { parse_mode: "MarkdownV2", ...keyboard });

        await saveMessage("main_menu", ctx.chat.id, sentMsg.message_id);
    }
};
