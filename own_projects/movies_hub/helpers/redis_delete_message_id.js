const redis = require('../../../globle_helper/redisConfig');

module.exports = async (bot) => {
  try {
    const allEntries = await redis.lrange("moviehub:message_ids", 0, -1);

    if (allEntries.length === 0) {
      console.log("⚠️ No messages found in Redis.");
      return;
    }

    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000; // 10 min in ms
    const remainingEntries = [];

    for (const entry of allEntries) {
      try {
        const { chatId, messageId, timestamp } = JSON.parse(entry);

        if (!chatId || !messageId || !timestamp) {
          console.warn("⚠️ Invalid entry in Redis, removing:", entry);
          continue; // ❌ Invalid → Redis se hata denge
        }

        if (now - timestamp >= tenMinutes) {
          // purana message
          try {
            await bot.telegram.deleteMessage(chatId, messageId);
            console.log(`🗑️ Deleted message ${messageId} in chat ${chatId} (age: ${(now - timestamp) / 1000}s)`);
            // ✅ Success → Redis me wapas mat daalo
          } catch (err) {
            console.error(`⚠️ Failed to delete message ${messageId}:`, err.message);
            // ❌ Agar message already delete ho chuka hai ya chat missing hai,
            // to bhi Redis me wapas mat daalo
          }
        } else {
          // abhi valid hai → Redis me rakhna hai
          remainingEntries.push(entry);
        }
      } catch (parseErr) {
        console.error("❌ Failed to parse entry, removing:", parseErr.message);
        // ❌ Malformed JSON → Redis se hata dena
      }
    }

    // ✅ Redis list ko reset karo (sirf valid bachi entries rakho)
    await redis.del("moviehub:message_ids");
    if (remainingEntries.length > 0) {
      await redis.rpush("moviehub:message_ids", ...remainingEntries);
    }

    console.log("✅ Redis cleaned: expired/invalid messages removed.");
  } catch (error) {
    console.error("❌ Error deleting messages:", error.message);
  }
};
