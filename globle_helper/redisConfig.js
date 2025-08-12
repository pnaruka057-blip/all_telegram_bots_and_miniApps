const Redis = require("ioredis");

let redis;

if (process.env.NODE_ENV === "production") {
    // Production Redis (Railway)
    redis = new Redis({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD
    });
} else {
    redis = new Redis(); // defaults to 127.0.0.1:6379
}

// Event listeners for connection status
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