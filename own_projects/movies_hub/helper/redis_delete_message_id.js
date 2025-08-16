const redis = require('../../../globle_helper/redisConfig');

module.exports = async (ctx) => {
  try {
    // 1. Redis se sabhi message IDs lo
    const allMessageIds = await redis.lrange("moviehub:message_ids", 0, -1); // ✅ lowercase

    if (allMessageIds.length === 0) {
      console.log("⚠️ No messages found in Redis.");
      return;
    }

    // 2. Har ek message delete karo
    for (const messageId of allMessageIds) {
      try {
        await ctx.deleteMessage(messageId);
        console.log(`🗑️ Deleted message ${messageId}`);
      } catch (err) {
        console.error(`❌ Failed to delete message ${messageId}:`, err.message);
      }
    }

    // 3. Redis list clear karo
    await redis.del("moviehub:message_ids");

    console.log("✅ All messages deleted from Telegram & Redis.");
  } catch (error) {
    console.error("❌ Error deleting messages:", error.message);
  }
};
