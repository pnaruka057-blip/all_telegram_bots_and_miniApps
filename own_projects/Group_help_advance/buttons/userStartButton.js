const { Markup } = require("telegraf");
const safeEditOrSend = require("../helpers/safeEditOrSend");
const encode_payload = require("../helpers/encode_payload");
const user_setting_module = require("../models/user_settings_module");

// simple HTML escaper for user-provided text
function escapeHTML(input) {
    return String(input || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

module.exports = async (ctx) => {
    const nameSafe = escapeHTML(ctx.from?.first_name || ctx.from?.username || "there");

    try {
        const userId = ctx.from?.id;
        if (userId && user_setting_module) {
            await user_setting_module.findOneAndUpdate(
                { user_id: Number(userId) },
                {
                    $setOnInsert: {
                        user_id: Number(userId),
                    },
                },
                { upsert: true, new: true }
            );
        }
    } catch (e) {
        console.error("Failed to upsert user on /start:", e);
    }

    const payloadPrivacy = `group-help-advance:privacy-policy`;
    const privacyLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encode_payload(payloadPrivacy)}`;

    const payloadInfo = `group-help-advance:`;
    const infoLink = `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}/${process.env.MINI_APP_NAME_GROUP_HELP_ADVANCE}?startapp=${encode_payload(payloadInfo)}`;

    const text =
        `👋 Hi ${nameSafe}!\n\n` +
        `<b>Group Help Advance</b> is the most complete Bot to help you <b>manage</b> your <b>Groups</b> and <b>Channels</b> easily and safely!\n\n` +
        `👉 <b>Add me in a Supergroup or Channel</b> and promote me as Admin to let me get in action!\n\n` +
        `<a href="${privacyLink}">Privacy policy</a>`;

    // IMPORTANT: env me username without @ ho sakta hai, isliye direct t.me/<username> ok hai
    const groupUsername = String(process.env.GROUP_HELP_ADVANCE_TELEGRAM_GROUP || "").trim();
    const channelUsername = String(process.env.GROUP_HELP_ADVANCE_TELEGRAM_CHANNEL || "").trim();
    const supportUsername = String(process.env.GROUP_HELP_ADVANCE_SUPPORT_ACCOUNT || "").trim();

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.url(
                "➕ Add me to a Group",
                `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}?startgroup=true`
            ),
        ],
        [
            Markup.button.url(
                "➕ Add me to a Channel",
                `https://t.me/${process.env.BOT_USERNAME_GROUP_HELP_ADVANCE}?startchannel=true`
            ),
        ],
        [Markup.button.callback("⚙️ Manage Group Settings ✍️", "MANAGE_GROUPS")],
        [Markup.button.callback("⚙️ Manage Channel Settings ✍️", "MANAGE_CHANNELS")],
        [
            Markup.button.url("👥 Group", `https://t.me/${groupUsername}`),
            Markup.button.url("📢 Channel", `https://t.me/${channelUsername}`),
        ],
        [Markup.button.callback("🔎 Find Groups & Channels", "FIND_GROUPS_CHANNELS")],
        [
            Markup.button.url("🔴 Support", `https://t.me/${supportUsername}`),

            // ✅ FIX: webApp button ki jagah normal URL button, because infoLink is t.me deep-link
            Markup.button.url("ℹ️ Information ...", infoLink),
        ],
    ]);

    await safeEditOrSend(ctx, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...keyboard,
    });

    // show ad for block id 'int-20013' (numeric part is 20013)
    // await sendAdsgramAd(ctx, 'int-20340', { language: 'en' });
};