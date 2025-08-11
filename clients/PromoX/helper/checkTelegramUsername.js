const axios = require("axios");
const botToken = process.env.BOT_TOKEN
async function checkTelegramUsername(username) {
    try {
        // Agar username me @ nahi hai to add karo
        if (!username.startsWith("@")) {
            username = "@" + username;
        }

        const url = `https://api.telegram.org/bot${botToken}/getChat?chat_id=${username}`;
        const res = await axios.get(url);

        if (!res.data.ok) {
            return { valid: false, reason: res.data.description };
        }

        const type = res.data.result.type; // channel | supergroup | group | private
        return { valid: true, type };
    } catch (err) {
        return { valid: false, reason: err.message };
    }
}

module.exports = checkTelegramUsername