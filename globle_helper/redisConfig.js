const Redis = require("ioredis");

let redis;

if (process.env.NODE_ENV === "production") {
    redis = new Redis(process.env.REDIS_URL);
} else {
    redis = new Redis(); // Local default
}

redis.on("connect", () => {
    console.log("✅ Redis connected successfully");
});

redis.on("error", (err) => {
    console.error("❌ Redis connection error:", err);
});

redis.on("ready", () => {
    console.log("🚀 Redis is ready to use");
});

module.exports = redis;
