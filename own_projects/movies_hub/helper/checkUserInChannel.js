async function checkUserInChannel(userId, bot) {
  try {
    const res = await bot.telegram.getChatMember(`@${process.env.CHANNEL_ID_MOVIEHUB}`, userId);
    const status = res.status;
    return status === "member" || status === "administrator" || status === "creator";
  } catch (err) {
    console.error("Failed to check user in channel:", err);
    return false;
  }
}

module.exports = checkUserInChannel;