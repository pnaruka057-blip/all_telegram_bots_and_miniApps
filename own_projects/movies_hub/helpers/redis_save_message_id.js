const redis = require('../../../globle_helper/redisConfig');

module.exports = async (messageId, chatId) => {
  try {
    if (!messageId) {
      throw new Error("Message ID is required");
    }
    if (!chatId) {
      throw new Error("Chat ID is required");
    }

    // Current timestamp in milliseconds
    const timestamp = Date.now();

    // Redis list me object store karo (stringify karke)
    const data = JSON.stringify({ messageId, chatId, timestamp });

    await redis.lpush("moviehub:message_ids", data);

    console.log(`✅ Message ID ${messageId} (Chat: ${chatId}) stored in Redis with timestamp ${timestamp}`);
  } catch (error) {
    console.error("❌ Error storing message ID in Redis:", error.message);
  }
};
