const cron = require('node-cron')
const redis = require('../../../globle_helper/redisConfig')
const redis_delete_message = require('./redis_delete_message_id')

// ✅ Start cron for FIND_SHOWS auto delete
async function startCron(bot) {
    cronJob = cron.schedule("*/10 * * * *", async () => {
        try {
            const keys_shows = await redis.keys("find_shows:*");
            const keys_movies = await redis.keys("find_movies:*");
            const keys_main_menu = await redis.keys("main_menu:*");

            if (keys_shows.length === 0 && keys_movies.length === 0 && keys_main_menu.length === 0) return

            for (const key of keys_shows) {
                const data = await redis.get(key);
                if (!data) {
                    await redis.del(key).catch(() => { });
                    continue;
                }

                let arr;
                try {
                    arr = JSON.parse(data);
                } catch (err) {
                    console.log(`⚠️ Malformed JSON for ${key}, removing key`);
                    await redis.del(key).catch(() => { });
                    continue;
                }

                if (!Array.isArray(arr) || arr.length === 0) {
                    await redis.del(key).catch(() => { });
                    continue;
                }

                const now = Date.now();
                const remaining = [];

                for (const item of arr) {
                    // validate shape
                    if (!item || !item.chatId || !item.messageId || !item.expireAt) {
                        continue; // skip invalid entries
                    }

                    if (now >= item.expireAt) {
                        try {
                            await bot.telegram.deleteMessage(item.chatId, item.messageId);
                            console.log(`🗑 Deleted FIND_SHOWS msg ${item.messageId} for chat ${item.chatId}`);
                        } catch (err) {
                            console.log(`Delete failed for ${item.messageId}:`, err.message);
                        }
                    } else {
                        remaining.push(item);
                    }
                }

                if (remaining.length > 0) {
                    await redis.set(key, JSON.stringify(remaining));
                } else {
                    await redis.del(key).catch(() => { });
                }
            }
            for (const key of keys_movies) {
                const data = await redis.get(key);
                if (!data) {
                    await redis.del(key).catch(() => { });
                    continue;
                }

                let arr;
                try {
                    arr = JSON.parse(data);
                } catch (err) {
                    // malformed data -> safe cleanup
                    console.log(`⚠️ Malformed JSON for ${key}, removing key`);
                    await redis.del(key).catch(() => { });
                    continue;
                }

                if (!Array.isArray(arr) || arr.length === 0) {
                    await redis.del(key).catch(() => { });
                    continue;
                }

                const now = Date.now();
                const remaining = [];

                for (const item of arr) {
                    // validate item shape
                    if (!item || !item.chatId || !item.messageId || !item.expireAt) {
                        continue; // skip invalid entries
                    }

                    if (now >= item.expireAt) {
                        try {
                            await bot.telegram.deleteMessage(item.chatId, item.messageId);
                            console.log(`🗑 Deleted FIND_MOVIES msg ${item.messageId} for chat ${item.chatId}`);
                        } catch (err) {
                            // message already deleted / not found -> log and continue
                            console.log(`Delete failed for ${item.messageId}:`, err.message);
                        }
                    } else {
                        // not expired yet -> keep it
                        remaining.push(item);
                    }
                }

                if (remaining.length > 0) {
                    await redis.set(key, JSON.stringify(remaining));
                } else {
                    await redis.del(key).catch(() => { });
                }
            }
            for (const key of keys_main_menu) {
                const data = await redis.get(key);
                if (!data) {
                    await redis.del(key).catch(() => { }); // cleanup
                    continue;
                }

                let arr;
                try {
                    arr = JSON.parse(data);
                } catch (err) {
                    console.log(`⚠️ Malformed JSON for ${key}, removing key`);
                    await redis.del(key).catch(() => { });
                    continue;
                }

                if (!Array.isArray(arr) || arr.length === 0) {
                    await redis.del(key).catch(() => { });
                    continue;
                }

                const now = Date.now();
                const remaining = [];

                for (const item of arr) {
                    // validate item shape
                    if (!item || !item.chatId || !item.messageId || !item.expireAt) {
                        continue; // skip invalid entries
                    }

                    if (now >= item.expireAt) {
                        try {
                            // use bot.telegram inside cron; replace `bot` with your bot instance variable
                            await bot.telegram.deleteMessage(item.chatId, item.messageId);
                            console.log(`🗑 Deleted main_menu msg ${item.messageId} for chat ${item.chatId}`);
                        } catch (err) {
                            console.log(`Delete failed for ${item.messageId}:`, err.message);
                        }
                    } else {
                        remaining.push(item);
                    }
                }

                if (remaining.length > 0) {
                    await redis.set(key, JSON.stringify(remaining));
                } else {
                    await redis.del(key).catch(() => { });
                }
            }
            redis_delete_message(bot)
            console.log("✅ Cleanup cron completed");
        } catch (err) {
            console.error("Cron error:", err.message);
        }
    });

    cronJob.start();
    console.log("✅ Cron started for cleanup");
}

module.exports = startCron