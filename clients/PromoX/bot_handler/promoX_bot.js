const axios = require("axios");

const requiredChannels = [
    process.env.CHANNEL_USERNAME_1_PROMOX,
    process.env.CHANNEL_USERNAME_2_PROMOX,
];

const joinLinks = [
    process.env.CHANNEL_URL_1_PROMOX,
    process.env.CHANNEL_URL_2_PROMOX,
    process.env.YOUTUBE_URL_PROMOX,
    process.env.X_URL_PROMOX,
    process.env.INSTAGRAM_URL_PROMOX,
];

// 🧠 Reusable function to check if user is member of all channels
const checkUserJoinedAllChannels = async (ctx, userId) => {
    return await Promise.all(
        requiredChannels.map(async (channel) => {
            try {
                const chatId = channel.startsWith("-") ? channel : `@${channel}`;
                const member = await ctx.telegram.getChatMember(chatId, userId);
                return ["member", "administrator", "creator"].includes(member.status);
            } catch (err) {
                console.error(`Error checking channel ${channel}:`, err.message);
                return false;
            }
        })
    );
};

// 🎁 Send Mini App welcome message
const sendMiniAppIntro = async (ctx, promoX_token) => {
    const res = await axios.get("https://res.cloudinary.com/dm8miilli/image/upload/v1754414545/photo_2025-08-05_22-50-34_mg99v5.jpg", {
        responseType: "arraybuffer"
    });
    await ctx.replyWithPhoto(
        { source: Buffer.from(res.data) },
        {
            caption: `
🌟 *Welcome to* 𝗣𝗥𝗢𝗠𝗢𝗫 💥  
🚀 *Your All-in-One Telegram Growth Hub!*

━━━━━━━━━━━━━━━━━━━  
📣 *Promote* your:
   • Channels 📢  
   • Groups 👥  
   • Content 🎯  

⚙️ *Smart Tools* + ⚡ *Instant Results* = 📈 *Real Growth*

🎯 No limits, no noise – *just pure audience & exposure!*

🔍 Let your ideal audience *discover you effortlessly* ✨  
━━━━━━━━━━━━━━━━━━━  
👇 Tap below to launch the magic ⬇️
      `,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "🌐 Open Mini App",
                            web_app: {
                                url: `${process.env.GLOBLE_DOMAIN}/${promoX_token}/promox`, // ✅ mini app URL
                                request_full_screen: true
                            },
                        },
                    ],
                ],
            },
        }
    );
};

// 📦 Main export
module.exports = (bot) => {
    // /start command
    bot.start(async (ctx) => {
        const userId = ctx.from.id;
        const results = await checkUserJoinedAllChannels(ctx, userId);
        const allJoined = results.every((status) => status === true);

        if (allJoined) {
            await ctx.reply("✅ You're already a member of all channels!");
            await sendMiniAppIntro(ctx, process.env.PROMOX_TOKEN);
        } else {
            const firstName = ctx.from.first_name;
            const res = await axios.get("https://media.istockphoto.com/id/1501791585/vector/group-of-diverse-young-men-wave-their-hands-in-welcoming-gesture-happy-persons-hold-greeting.jpg?s=612x612&w=0&k=20&c=AHiu86YNoZsjmDd7wRTHoJnBFl1yxX7lAbnm58r5eHk=", {
                responseType: "arraybuffer"
            });
            await ctx.replyWithPhoto(
                { source: Buffer.from(res.data) },
                {
                    caption: `👋 *Welcome, ${firstName}!*\n\nPlease join all channels below to continue.`,
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '📢 Join Now 1', url: joinLinks[0] },
                                { text: '📢 Join Now 2', url: joinLinks[1] }
                            ],
                            [
                                { text: '🎥 SUBSCRIBE', url: joinLinks[2] },
                                { text: '🐦 Follow Us on X', url: joinLinks[3] }
                            ],
                            [
                                { text: '📷 Follow Us on Instagram', url: joinLinks[4] }
                            ],
                            [
                                { text: '✅ I’ve Completed Joining ✔️', callback_data: 'JOINED_DONE' }
                            ]
                        ]
                    },
                }
            );
        }
    });

    // ✅ Join verification
    bot.action("JOINED_DONE", async (ctx) => {
        const userId = ctx.from.id;
        const results = await checkUserJoinedAllChannels(ctx, userId);
        const allJoined = results.every((status) => status === true);

        if (allJoined) {
            await ctx.answerCbQuery("✅ Verified! You’ve joined all channels.");
            await ctx.deleteMessage();
            await sendMiniAppIntro(ctx);
        } else {
            await ctx.answerCbQuery("❌ Please join all channels first!", { show_alert: true });
        }
    });
};
