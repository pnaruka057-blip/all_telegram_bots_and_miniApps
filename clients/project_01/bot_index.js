// clients/project_01/bot_index.js
const crypto = require("crypto");
const { Markup } = require("telegraf");

const user_model = require("./models/user_module");
const invite_model = require("./models/invite_model");
const transactions_model = require("./models/transactions_model");
const other_model = require("./models/other_model"); // <-- commission rates
const encode_payload = require("./helpers/encode_payload");

// In-memory user flow state (use Redis/session in production)
const userState = new Map(); // telegram_user_id -> { step, data }

function setState(tgUserId, step, data = {}) {
    userState.set(tgUserId, { step, data });
}
function getState(tgUserId) {
    return userState.get(tgUserId) || { step: null, data: {} };
}
function clearState(tgUserId) {
    userState.delete(tgUserId);
}

function normalizeStr(s) {
    return (s || "").toString().trim();
}

function getUpiString(v) {
    if (typeof v !== "string") return "";
    return v.trim();
}

function isValidUpi(upi) {
    const u = (upi || "").trim();
    // Simple UPI format check: name@bank
    return /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/i.test(u);
}

function parseAmount(text) {
    const n = Number(String(text || "").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.floor(n * 100) / 100;
}

/**
 * Generate a unique invite code.
 * Keeps trying until a code is confirmed not present in the user collection.
 * Will try up to maxAttempts (default 200) then throw.
 */
async function generateUniqueInviteCode(maxAttempts = 200) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // generate 8-char hex code
        const code = crypto.randomBytes(4).toString("hex");
        // check existence
        const exists = await user_model.findOne({ invite_code: code }).select("_id").lean();
        if (!exists) return code;
        // else loop again
    }
    // If we somehow exhausted attempts, try a longer code once
    for (let attempt = 0; attempt < 50; attempt++) {
        const code = crypto.randomBytes(6).toString("hex"); // 12 chars
        const exists = await user_model.findOne({ invite_code: code }).select("_id").lean();
        if (!exists) return code;
    }
    throw new Error("Failed to generate unique invite code after many attempts");
}

function introText() {
    return (
        "Welcome to Project 01.\n\n" +
        "You can manage your balance, invites, withdrawals, and reports using the menu.\n" +
        "To activate your account, please complete the first deposit."
    );
}

function pendingMenu() {
    return Markup.keyboard([["First Deposit ₹1000"]]).resize().persistent();
}

function activeMenu() {
    return Markup.keyboard([
        ["Check Balance", "Invite", "Daily Bonus"],
        ["Team Report", "Transactions Report"],
        ["Withdraw", "Add Payment Details"],
    ])
        .resize()
        .persistent();
}

async function sendMenu(ctx, userDoc) {
    if (!userDoc || userDoc.registration_status !== "ACTIVE") {
        return ctx.reply("Menu (Activation required):", pendingMenu());
    }
    return ctx.reply("Menu:", activeMenu());
}

function getInviteBotLink(inviteCode) {
    const botUsername = process.env.BOT_USERNAME_PROJECT_01;
    return `https://t.me/${botUsername}?start=${encodeURIComponent(inviteCode)}`;
}

function getMiniAppLink(type, userDB_id) {
    const payload = `project-01:${type}:${userDB_id}`;
    return `https://t.me/${process.env.BOT_USERNAME_PROJECT_01}/${process.env.MINI_APP_NAME_PROJECT_01}?startapp=${encode_payload(
        payload
    )}`;
}

/**
 * Distribute registration commission up to 7 levels.
 *
 * Now accepts `bot` so it can send a direct message to each inviter who receives commission.
 *
 * @param {Object} bot - telegraf bot instance (to send messages)
 * @param {Object} newUserDoc - The Mongoose document of the newly activated user
 * @param {Number} amount - deposit amount (number)
 */
async function distributeRegistrationCommission(bot, newUserDoc, amount) {
    if (!newUserDoc || !newUserDoc._id) return;
    if (!amount || amount <= 0) return;

    // Load commission rates (explicitly look for a config doc named commission_rates)
    const ratesDoc = await other_model.findOne({ document_name: "commission_rates" }) || null;
    if (!ratesDoc) {
        // No rates configured - nothing to distribute
        return;
    }

    // Helper to fetch rate for level n
    const getRateForLevel = (n) => {
        const key = `level_${n}_rate`;
        const val = ratesDoc[key];
        return typeof val === "number" && !Number.isNaN(val) ? Number(val) : 0;
    };

    // Walk the invite chain upwards: start by taking the relation where invite_to_userDB_id = newUserDoc._id
    // At each step, find the invited_by_userDB_id (the inviter). Continue up to 7 levels or until no inviter found.
    let currentInviteToId = newUserDoc._id;
    for (let level = 1; level <= 7; level++) {
        // Find the direct invite document where invite_to_userDB_id = currentInviteToId
        // This gives us who invited the current node
        const inviteRel = await invite_model.findOne({
            invite_to_userDB_id: currentInviteToId,
        }).select("invited_by_userDB_id invite_to_userDB_id code earned_commission").lean();

        if (!inviteRel || !inviteRel.invited_by_userDB_id) {
            // no further inviter
            break;
        }

        const inviterId = inviteRel.invited_by_userDB_id;
        const rate = getRateForLevel(level);
        if (rate > 0) {
            // compute commission amount (2 decimal places)
            const commission = Number(((amount * rate) / 100).toFixed(2));

            if (commission > 0) {
                // Credit inviter's wallet (atomic $inc)
                await user_model.updateOne({ _id: inviterId }, { $inc: { wallet_balance: commission } });

                // Create a transaction record for this commission
                const note = `Invite commission: Level ${level} (${rate}%)`;
                await transactions_model.create({
                    userDB_id: inviterId,
                    type: "I",
                    amount: commission,
                    status: "S", // success (credited)
                    note,
                    created_at: new Date(),
                });

                // Update the earned_commission on the invite relation between inviter -> invitee (if that relation exists)
                await invite_model.updateOne(
                    { invited_by_userDB_id: inviterId, invite_to_userDB_id: currentInviteToId },
                    { $inc: { earned_commission: commission } }
                );

                // Fetch inviter user data to send message
                const inviterDoc = await user_model.findById(inviterId).select("user_id first_name username wallet_balance").lean();
                if (inviterDoc && inviterDoc.user_id) {
                    // get updated balance
                    const freshInviter = await user_model.findById(inviterId).select("wallet_balance").lean();
                    const newBalance = (freshInviter && freshInviter.wallet_balance) ? freshInviter.wallet_balance : 0;

                    // Compose message (formal).
                    const fromUserRef = newUserDoc.username ? `@${newUserDoc.username}` : (newUserDoc.user_id || String(newUserDoc._id));
                    const message = [
                        `A commission has been credited to your account.`,
                        ``,
                        `Amount: ₹${commission}`,
                        `Level: ${level}`,
                        `Rate: ${rate}%`,
                        `From: ${fromUserRef}`,
                        `Your updated wallet balance is: ₹${newBalance}`,
                        ``,
                        `Note: This is an invite commission for a user's first deposit.`
                    ].join("\n");

                    // Send message; swallow errors (user may have blocked bot)
                    try {
                        await bot.telegram.sendMessage(inviterDoc.user_id, message);
                    } catch (sendErr) {
                        console.error(`Failed to send commission message to user ${inviterDoc.user_id}:`, sendErr);
                        // continue distributing to other levels
                    }
                }
            }
        }

        // Move up the chain: now consider who invited this inviter
        currentInviteToId = inviterId;
    }
}

async function upsertUserFromCtx(ctx) {
    const tg = ctx.from;
    const telegramUserId = tg?.id;

    let user = await user_model.findOne({ user_id: telegramUserId });

    if (!user) {
        // generate a unique code
        const invite_code = await generateUniqueInviteCode();
        user = await user_model.create({
            user_id: telegramUserId,
            first_name: normalizeStr(tg.first_name),
            last_name: normalizeStr(tg.last_name),
            username: normalizeStr(tg.username),
            allows_write_to_pm: Boolean(tg.allows_write_to_pm),
            invite_code,
            registration_status: "PENDING",
            wallet_balance: 0,
            created_at: new Date(),
        });

        // DOUBLE-CHECK uniqueness (rare race) and fix if conflict exists
        let safetyAttempts = 0;
        while (safetyAttempts < 20) {
            const conflict = await user_model.findOne({
                invite_code: user.invite_code,
                _id: { $ne: user._id },
            }).select("_id").lean();
            if (!conflict) break; // unique
            // conflict found - regenerate and update user record
            const newCode = await generateUniqueInviteCode();
            await user_model.updateOne({ _id: user._id }, { $set: { invite_code: newCode } });
            user = await user_model.findById(user._id);
            safetyAttempts++;
        }
        if (safetyAttempts >= 20) {
            console.error("Warning: high number of invite_code conflicts while creating user:", user._id);
        }
    } else {
        await user_model.updateOne(
            { _id: user._id },
            {
                $set: {
                    first_name: normalizeStr(tg.first_name),
                    last_name: normalizeStr(tg.last_name),
                    username: normalizeStr(tg.username),
                    allows_write_to_pm: Boolean(tg.allows_write_to_pm),
                },
            }
        );
        user = await user_model.findById(user._id);
    }

    // If user existed but somehow has no invite_code, create one and ensure uniqueness
    if (!user.invite_code) {
        const invite_code = await generateUniqueInviteCode();
        await user_model.updateOne({ _id: user._id }, { $set: { invite_code } });
        user = await user_model.findById(user._id);

        // Double-check uniqueness again
        let safetyAttempts = 0;
        while (safetyAttempts < 20) {
            const conflict = await user_model.findOne({
                invite_code: user.invite_code,
                _id: { $ne: user._id },
            }).select("_id").lean();
            if (!conflict) break;
            const newCode = await generateUniqueInviteCode();
            await user_model.updateOne({ _id: user._id }, { $set: { invite_code: newCode } });
            user = await user_model.findById(user._id);
            safetyAttempts++;
        }
        if (safetyAttempts >= 20) {
            console.error("Warning: high number of invite_code conflicts while ensuring invite_code:", user._id);
        }
    }

    return user;
}

async function handleStartPayload(payload, newUserDoc) {
    const code = (payload || "").trim();
    if (!code) return;
    if (!newUserDoc) return;

    // Ignore self-invite
    if (code === newUserDoc.invite_code) return;

    const inviter = await user_model.findOne({ invite_code: code }).select("_id").lean();
    if (!inviter) return;

    // Save direct invite relation once 
    const exists = await invite_model.findOne({
        invited_by_userDB_id: inviter._id,
        invite_to_userDB_id: newUserDoc._id,
    }).lean();

    if (!exists) {
        await invite_model.create({
            code,
            invited_by_userDB_id: inviter._id,
            invite_to_userDB_id: newUserDoc._id,
            earned_commission: 0,
            created_at: new Date(),
        });
    }
}

module.exports = (bot) => {
    // /start
    bot.start(async (ctx) => {
        try {
            clearState(ctx.from.id);

            const user = await upsertUserFromCtx(ctx);

            const payload =
                ctx.startPayload ||
                ctx.message?.text?.split(" ")?.slice(1)?.join(" ") ||
                "";

            await handleStartPayload(payload, user);

            await ctx.reply(introText());
            await sendMenu(ctx, user);
        } catch (err) {
            console.error("start error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    async function ensureUser(ctx) {
        const user = await user_model.findOne({ user_id: ctx.from.id });
        if (!user) {
            await ctx.reply("Please use /start first.");
            return null;
        }
        return user;
    }

    async function ensureActive(ctx) {
        const user = await ensureUser(ctx);
        if (!user) return null;

        if (user.registration_status !== "ACTIVE") {
            await ctx.reply(
                "Your account is not active yet. Please complete the first deposit.",
                pendingMenu()
            );
            return null;
        }
        return user;
    }

    // ------------------------
    // PENDING: First deposit
    // ------------------------
    bot.hears("First Deposit ₹1000", async (ctx) => {
        try {
            const user = await ensureUser(ctx);
            if (!user) return;

            if (user.registration_status === "ACTIVE") {
                await ctx.reply("Your account is already active.", activeMenu());
                return;
            }

            const demoPayUrl =
                process.env.DEMO_PAYMENT_URL || "https://example.com/pay?amount=1000";

            await ctx.reply(
                "First Deposit: ₹1000\n\nPayment link (demo):\n" +
                demoPayUrl +
                "\n\nAfter payment, tap: “I have paid (demo)”",
                Markup.inlineKeyboard([
                    [Markup.button.url("Pay Now (Demo)", demoPayUrl)],
                    [Markup.button.callback("I have paid (demo)", "P01_PAY_DONE_DEMO")],
                    [Markup.button.callback("Back to Menu", "P01_MENU")],
                ])
            );
        } catch (err) {
            console.error("deposit error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // Helper: create and start verifying spinner (edits a message every 500ms with ., .., ...)
    async function sendVerifyingSpinner(ctx) {
        try {
            const sent = await ctx.reply("Verifying");
            const chatId = (sent && sent.chat && sent.chat.id) ? sent.chat.id : ctx.chat.id;
            const messageId = sent.message_id;
            const frames = ["", ".", "..", "..."];
            let idx = 0;
            const interval = setInterval(async () => {
                try {
                    const text = `Verifying${frames[idx % frames.length]}`;
                    idx++;
                    await ctx.telegram.editMessageText(chatId, messageId, undefined, text);
                } catch (err) {
                    // ignore edit errors (rate limit, message deleted, etc.)
                }
            }, 500);
            return { interval, chatId, messageId };
        } catch (err) {
            console.error("Failed to send verifying spinner message:", err);
            return null;
        }
    }

    // Demo payment success -> Activate account
    bot.action("P01_PAY_DONE_DEMO", async (ctx) => {
        let spinner = null;
        try {
            await ctx.answerCbQuery();

            const user = await ensureUser(ctx);
            if (!user) return;

            if (user.registration_status === "ACTIVE") {
                await ctx.reply("Your account is already active.", activeMenu());
                return;
            }

            // Set active (mark immediately so other flows see change)
            await user_model.updateOne(
                { _id: user._id },
                { $set: { registration_status: "ACTIVE" } }
            );

            // For demo, deposit amount is 1000. If you have real amount, pass that value here.
            const depositAmount = 1000;

            // Refresh user doc
            const fresh = await user_model.findById(user._id);

            // Send verifying spinner and start editing every 500ms
            spinner = await sendVerifyingSpinner(ctx);

            // Distribute commission up to 7 levels — pass bot so messages can be sent
            try {
                await distributeRegistrationCommission(bot, fresh, depositAmount);
            } catch (distErr) {
                console.error("Commission distribution error:", distErr);
            }

            // Stop spinner and delete verifying message
            if (spinner && spinner.interval) {
                clearInterval(spinner.interval);
            }
            if (spinner && spinner.chatId && spinner.messageId) {
                try {
                    await ctx.telegram.deleteMessage(spinner.chatId, spinner.messageId);
                } catch (delErr) {
                    // ignore deletion errors
                }
            }

            await ctx.reply("Payment received (demo). Your account is now active.");
            await sendMenu(ctx, fresh);
        } catch (err) {
            console.error("pay demo error:", err);
            // ensure spinner cleared if error
            if (spinner && spinner.interval) clearInterval(spinner.interval);
            if (spinner && spinner.chatId && spinner.messageId) {
                try {
                    await ctx.telegram.deleteMessage(spinner.chatId, spinner.messageId);
                } catch (e) { /* ignore */ }
            }
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_MENU", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            const user = await ensureUser(ctx);
            if (!user) return;
            await sendMenu(ctx, user);
        } catch (err) {
            console.error("menu action error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Check balance
    // ------------------------
    bot.hears("Check Balance", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            await ctx.reply(
                `Your wallet balance is: ₹${user.wallet_balance || 0}`,
                activeMenu()
            );
        } catch (err) {
            console.error("balance error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Invite link
    // ------------------------
    bot.hears("Invite", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const link = getInviteBotLink(user.invite_code);
            await ctx.reply(
                `Your invite code: ${user.invite_code}\nInvite link:\n${link}`
            );
        } catch (err) {
            console.error("invite error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Daily Bonus -> mini app
    // ------------------------
    bot.hears("Daily Bonus", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            // Generate mini-app link for daily bonus (tap-tap)
            const link = getMiniAppLink("daily-bonus", user._id.toString());

            // Explain that only the tapping user will receive the bonus
            const msg =
                "Daily Bonus: Tap the button below to open the app. Only you will earn the bonus when you tap inside the mini-app.";

            await ctx.reply(
                msg,
                Markup.inlineKeyboard([[Markup.button.url("Open Daily Bonus", link)]])
            );
        } catch (err) {
            console.error("daily bonus error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Team Report -> mini app
    // ------------------------
    bot.hears("Team Report", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const link = getMiniAppLink("team-report", user._id.toString());
            await ctx.reply(
                "Open Team Report:",
                Markup.inlineKeyboard([[Markup.button.url("Open Team Report", link)]])
            );
        } catch (err) {
            console.error("team report error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Transactions Report -> mini app
    // ------------------------
    bot.hears("Transactions Report", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const link = getMiniAppLink("transactions-report", user._id.toString());
            await ctx.reply(
                "Open Transactions Report:",
                Markup.inlineKeyboard([
                    [Markup.button.url("Open Transactions Report", link)],
                ])
            );
        } catch (err) {
            console.error("transactions report error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Withdraw flow
    // ------------------------
    bot.hears("Withdraw", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const tgUserId = ctx.from.id;
            const upi = getUpiString(user.upi_id);

            // If UPI is not set -> start UPI setup first
            if (!upi) {
                setState(tgUserId, "WAIT_UPI_FOR_WITHDRAW", {});
                await ctx.reply("Please send your UPI ID first (example: name@bank).");
                return;
            }

            // If set -> ask withdrawal amount
            setState(tgUserId, "WAIT_WITHDRAW_AMOUNT", { upi_id: upi });
            await ctx.reply(
                `UPI ID is set: ${upi}\nNow send the withdrawal amount (₹):`
            );
        } catch (err) {
            console.error("withdraw start error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // ACTIVE: Add Payment Details flow
    // ------------------------
    bot.hears("Add Payment Details", async (ctx) => {
        try {
            const user = await ensureActive(ctx);
            if (!user) return;

            const tgUserId = ctx.from.id;
            const upi = getUpiString(user.upi_id);

            if (upi) {
                setState(tgUserId, "CONFIRM_UPDATE_UPI", {});
                await ctx.reply(
                    `Current UPI ID: ${upi}\nDo you want to set a new UPI ID?`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback("Yes", "P01_UPI_UPDATE_YES"), Markup.button.callback("No", "P01_UPI_UPDATE_NO")],
                    ])
                );
                return;
            }

            setState(tgUserId, "WAIT_UPI_SET", {});
            await ctx.reply("Please send your UPI ID (example: name@bank).");
        } catch (err) {
            console.error("add payment details error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_UPI_UPDATE_YES", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            setState(ctx.from.id, "WAIT_UPI_SET", { force: true });
            await ctx.reply("Please send your new UPI ID (example: name@bank).");
        } catch (err) {
            console.error("upi update yes error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_UPI_UPDATE_NO", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            clearState(ctx.from.id);
            const user = await ensureActive(ctx);
            if (!user) return;
            await ctx.reply("Okay. Your UPI ID is unchanged.", activeMenu());
        } catch (err) {
            console.error("upi update no error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // Withdraw confirm callbacks
    // ------------------------
    bot.action("P01_WITHDRAW_CONFIRM_YES", async (ctx) => {
        try {
            await ctx.answerCbQuery();

            const user = await ensureActive(ctx);
            if (!user) return;

            const st = getState(ctx.from.id);
            const amount = Number(st.data?.amount || 0);
            const upi_id = getUpiString(st.data?.upi_id);

            if (!amount || amount <= 0 || !upi_id) {
                clearState(ctx.from.id);
                await ctx.reply("Invalid withdrawal request. Please try again.", activeMenu());
                return;
            }

            const fresh = await user_model.findById(user._id);
            if ((fresh.wallet_balance || 0) < amount) {
                clearState(ctx.from.id);
                await ctx.reply("Insufficient wallet balance.", activeMenu());
                return;
            }

            await transactions_model.create({
                userDB_id: fresh._id,
                type: "W",
                amount,
                status: "P",
                note: `Withdraw request to UPI: ${upi_id}`,
                created_at: new Date(),
            });

            // Deduct immediately (simple). Alternative: deduct after admin approval.
            await user_model.updateOne(
                { _id: fresh._id },
                { $inc: { wallet_balance: -amount } }
            );

            clearState(ctx.from.id);
            await ctx.reply(
                `Withdrawal request submitted.\nAmount: ₹${amount}\nUPI ID: ${upi_id}\nStatus: Pending`,
                activeMenu()
            );
        } catch (err) {
            console.error("withdraw confirm yes error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    bot.action("P01_WITHDRAW_CONFIRM_NO", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            clearState(ctx.from.id);
            const user = await ensureActive(ctx);
            if (!user) return;
            await ctx.reply("Withdrawal cancelled.", activeMenu());
        } catch (err) {
            console.error("withdraw confirm no error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // ------------------------
    // Text steps handler (UPI / Amount)
    // ------------------------
    bot.on("text", async (ctx) => {
        try {
            const tgUserId = ctx.from.id;
            const st = getState(tgUserId);
            if (!st.step) return;

            const user = await ensureActive(ctx);
            if (!user) {
                clearState(tgUserId);
                return;
            }

            const text = normalizeStr(ctx.message.text);

            // Capture UPI for withdraw OR payment details
            if (st.step === "WAIT_UPI_SET" || st.step === "WAIT_UPI_FOR_WITHDRAW") {
                if (!isValidUpi(text)) {
                    await ctx.reply(
                        "Invalid UPI ID format.\nExample: name@bank\nPlease send again:"
                    );
                    return;
                }

                const upi = text.trim();

                await user_model.updateOne(
                    { _id: user._id },
                    { $set: { upi_id: upi } }
                );

                // If user was in withdraw flow, continue to amount step
                if (st.step === "WAIT_UPI_FOR_WITHDRAW") {
                    setState(tgUserId, "WAIT_WITHDRAW_AMOUNT", { upi_id: upi });
                    await ctx.reply(
                        `UPI ID saved: ${upi}\nNow send the withdrawal amount (₹):`
                    );
                    return;
                }

                // Otherwise, just saved payment details
                clearState(tgUserId);
                await ctx.reply(`UPI ID saved.\nUPI ID: ${upi}`, activeMenu());
                return;
            }

            // Capture withdrawal amount
            if (st.step === "WAIT_WITHDRAW_AMOUNT") {
                const amount = parseAmount(text);
                if (!amount || amount <= 0) {
                    await ctx.reply(
                        "Invalid amount. Please send only a number (example: 200)."
                    );
                    return;
                }

                const fresh = await user_model.findById(user._id);
                if ((fresh.wallet_balance || 0) < amount) {
                    await ctx.reply(
                        `Insufficient wallet balance.\nCurrent: ₹${fresh.wallet_balance || 0}\nSend a smaller amount:`
                    );
                    return;
                }

                const upi_id = getUpiString(st.data?.upi_id) || getUpiString(fresh.upi_id);
                if (!upi_id) {
                    clearState(tgUserId);
                    await ctx.reply(
                        "UPI ID is missing. Please set payment details first.",
                        activeMenu()
                    );
                    return;
                }

                setState(tgUserId, "WITHDRAW_CONFIRM", { amount, upi_id });

                await ctx.reply(
                    `Please confirm your withdrawal:\nUPI ID: ${upi_id}\nAmount: ₹${amount}`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback("Yes", "P01_WITHDRAW_CONFIRM_YES"), Markup.button.callback("No", "P01_WITHDRAW_CONFIRM_NO")],
                    ])
                );
            }
        } catch (err) {
            console.error("text flow error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });

    // Optional: /menu
    bot.command("menu", async (ctx) => {
        try {
            const user = await upsertUserFromCtx(ctx);
            await sendMenu(ctx, user);
        } catch (err) {
            console.error("menu cmd error:", err);
            ctx.reply("Something went wrong. Please try again.");
        }
    });
};
