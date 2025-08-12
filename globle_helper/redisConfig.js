const Redis = require("ioredis");

let redis;

if (process.env.NODE_ENV === "production") {
    redis = new Redis({
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT,
        username: "default", // Railway Redis default username
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined // if Railway requires TLS
    });
} else {
    redis = new Redis();
}

redis.on("connect", () => {
    console.log("✅ Redis connected successfully");
});

redis.on("error", (err) => {
    console.error("❌ Redis connection error:", err.message);
});

redis.on("ready", () => {
    console.log("🚀 Redis is ready to use");
});

module.exports = redis;