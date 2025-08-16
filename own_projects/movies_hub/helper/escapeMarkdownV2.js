function escapeMarkdownV2(text) {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}
module.exports = escapeMarkdownV2;
