// bot_user_info_handler.js (example naam)
// Tumhare code ke hisaab se:
const bot_user_info_model = require('./module');

module.exports = (bot) => {
    // /start command
    bot.start(async (ctx) => {
        try {
            const user = ctx.from; // Telegram user info

            // Agar MongoDB model available hai tabhi save karo
            if (bot_user_info_model) {
                // Sirf naya user hone par insert hoga (upsert + $setOnInsert)
                await bot_user_info_model.findOneAndUpdate(
                    { user_id: user.id }, // condition: ye user pehle se hai ya nahi
                    {
                        $setOnInsert: {
                            user_id: user.id,
                            first_name: user.first_name || '',
                            last_name: user.last_name || '',
                            username: user.username || '',
                            language_code: user.language_code || '',
                            is_bot: user.is_bot || false,
                            created_at: new Date(),
                        },
                    },
                    {
                        upsert: true,    // agar nahi mila to naya document bana de
                        new: true,       // updated doc return kare (yaha use nahi ho raha)
                    }
                );
            }
        } catch (err) {
            console.error('Error saving user info:', err);
            // DB error hone par bhi user ko reply to kar hi denge
        }

        // Welcome message (Vietnamese)
        return ctx.reply(
            'Chào mừng bạn đến với bot Gái Xinh hãy cùng nhau phát triển nhé #gaixinh #gaidep'
        );
    });

    // /thongke command
    bot.command('thongke', async (ctx) => {
        try {
            if (!bot_user_info_model) {
                return ctx.reply('Database chưa sẵn sàng, vui lòng thử lại sau.');
            }

            // Total unique users ka count (jitne users ne kam se kam ek baar /start kiya)
            const totalUsers = await bot_user_info_model.countDocuments({});

            return ctx.reply(`Tổng số người dùng đã start bot: ${totalUsers}`);
        } catch (err) {
            console.error('Error getting stats:', err);
            return ctx.reply('Có lỗi xảy ra, vui lòng thử lại sau.');
        }
    });
};
