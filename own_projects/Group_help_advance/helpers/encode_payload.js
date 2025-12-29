function encodePayload(obj) {
    // payload ko string bana ke base64 encode karo
    return Buffer.from(obj).toString("base64");
}
 
module.exports = (payload) => encodePayload(payload);
// `${"movies-hub"}:${type}:${query}:${fromId}:${user_id}`
