const redis = require('../../../globle_helper/redisConfig');

module.exports = async (messageId) => {
  try {
    if (!messageId) {
      throw new Error("Message ID is required");
    }

    // Redis list me message ID store karo
    await redis.lpush("moviehub:message_ids", messageId);  // ✅ lowercase

    console.log(`✅ Message ID ${messageId} stored in Redis`);
  } catch (error) {
    console.error("❌ Error storing message ID in Redis:", error.message);
  }
};
