const { Markup } = require("telegraf");
const menu_btn_admin = require("../buttons/menu_btn_admin");
const menu_btn_users = require("../buttons/menu_btn_users");
const users_module = require("../models/users_module");
const checkUserInChannel = require("./checkUserInChannel");
const escapeMarkdownV2 = require('./escapeMarkdownV2');

module.exports = async (bot, ctx) => {
    if (ctx.scene?.current) {
        await ctx.scene.leave();
    }

    // Random positive reactions
    const reactions = [
        "😊 Welcome!",
        "🚀 Glad to have you here!",
        "🎉 You're awesome!",
        "🔥 Let's get started!",
        "🤗 Great to see you!",
        "🙌 Welcome aboard!"
    ];

    const sent = await ctx.reply('👋 Welcome! Please Wait ....', {
        reply_markup: {
            remove_keyboard: true
        },
    });

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    await sleep(1000); // 1 second wait
    await ctx.deleteMessage(sent.message_id).catch(console.error);
    // ab next code yaha chalega

    // Clear session
    ctx.session = null;

    if (ctx?.from?.id === parseInt(process.env.ADMIN_ID_MOVIEHUB)) {
        return menu_btn_admin(ctx)
    } else {

        let profileUrl = "https://res.cloudinary.com/dm8miilli/image/upload/v1755791642/profile_hbb9k4.png"; // default profile image URL

        try {
            const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);
            if (photos.total_count > 0) {
                const fileId = photos.photos[0][0].file_id; // sabse chhoti size wali photo
                const file = await ctx.telegram.getFile(fileId);
                profileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN_MOVIEHUB}/${file.file_path}`;
            }
        } catch (err) {
            console.error("Profile fetch error:", err);
        }

        const user = await users_module.findOneAndUpdate({ user_id: ctx?.from?.id }, { user_logo: profileUrl }, { new: true });

        // Agar user nahi mila to DB me insert karo
        if (!user) {
            await users_module.create({
                user_id: ctx.from.id,
                name: ctx.from.first_name,
                username: ctx.from.username,
                language: null,
                user_logo: profileUrl
            });
        }

        const userFirstName = ctx.from.first_name || "there";
        const randomMessage = reactions[Math.floor(Math.random() * reactions.length)];
        let is_channel_member = await checkUserInChannel(ctx.from.id, bot);

        // ✅ Language already selected hai
        if (user && user.language) {
            if (is_channel_member) {
                return menu_btn_users(ctx);
            } else {
                await ctx.reply("🔒 Please join our *Backup Channel* to continue using the bot:", {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.url("📢 Join Backup Channel", `https://t.me/${process.env.CHANNEL_ID_MOVIEHUB}`)],
                        [Markup.button.callback("✅ I've Joined", "CHECK_JOIN_BACKUP")]
                    ])
                });
                return;
            }
        }

        // ❌ Language not set
        const welcomeText = `${randomMessage.replace(/!/g, '\\!')} *Hi ${escapeMarkdownV2(userFirstName)}* 👋\n\nPlease select your preferred language to continue with accessing your favorite *Movies & Shows*\\.`

        ctx.replyWithMarkdownV2(welcomeText, Markup.inlineKeyboard([
            [Markup.button.callback("🇬🇧 English", "LANG_EN"), Markup.button.callback("🇮🇳 Hindi", "LANG_HI")],
            [Markup.button.callback("🇮🇳 Tamil", "LANG_TM"), Markup.button.callback("🇮🇳 Telugu", "LANG_TE")],
            // [Markup.button.callback("Request", "LANG_REQUEST")]
        ]));
    }
};
