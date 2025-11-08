// Verify bot is admin in the provided group identifier
async function verifyBotAdminInGroup(ctx, ident) {
    try {
        let chatIdToCheck = null;
        if (ident.startsWith("@")) {
            const chat = await ctx.telegram.getChat(ident);
            chatIdToCheck = chat.id;
        } else if (ident.startsWith("-100")) {
            chatIdToCheck = Number(ident);
            // quick ensure getChat works
            await ctx.telegram.getChat(chatIdToCheck);
        } else {
            return false;
        }
        const me = await ctx.telegram.getMe();
        const member = await ctx.telegram.getChatMember(chatIdToCheck, me.id);
        const status = member?.status;
        // acceptable admin statuses: administrator or creator
        return status === "administrator" || status === "creator";
    } catch (e) {
        return false;
    }
}

module.exports = verifyBotAdminInGroup