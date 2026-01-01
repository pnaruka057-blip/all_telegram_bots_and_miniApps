const express = require('express')
const app = express()
const upload = require('../../../globle_helper/multer_file_upload_mongoDB')
const checkTelegramUsername = require('../helpers/checkTelegramUsername')
const path = require('path')
const user_setting_module = require('../models/user_settings_module');
const expressEjsLayouts = require('express-ejs-layouts');
let group_help_advance_token = process.env.GROUP_HELP_ADVANCE_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME
const { StringSession } = require("telegram/sessions");
const { Api, TelegramClient } = require("telegram");
const apiId = 26293359;
const apiHash = "2336f25264cbdbd6acbd248a7df09eeb";

function buildClient(sessionString) {
    const ss = new StringSession(sessionString || "");
    return new TelegramClient(ss, apiId, apiHash, { connectionRetries: 3 });
}

async function closeClient(client) {
    if (!client) return;
    try { await client.disconnect(); } catch (e) { }
    try { await client.destroy(); } catch (e) { }
}

function safeMsg(err) {
    return (
        err?.response?.data?.message ||
        err?.errorMessage ||
        err?.message ||
        "Something went wrong"
    );
}

async function validateSessionAndGetClient(sessionString) {
    if (!sessionString || !String(sessionString).trim()) return { ok: false, client: null, me: null };

    const client = buildClient(sessionString);
    try {
        await client.connect();
        const me = await client.getMe(); // invalid session => throw / null
        if (!me) {
            await closeClient(client);
            return { ok: false, client: null, me: null };
        }
        return { ok: true, client, me };
    } catch (e) {
        await closeClient(client);
        return { ok: false, client: null, me: null };
    }
}

async function buildChatLink(client, dialog) {
    const entity = dialog.entity;
    const username = entity?.username ? String(entity.username).trim() : "";

    if (username) {
        return `https://t.me/${username}`;
    }

    // Private supergroup/channel: t.me/c/<id>/<msgId> works (member-only) [web:282]
    if (dialog.isChannel) {
        try {
            const msgs = await client.getMessages(dialog.inputEntity, { limit: 1 });
            const last = msgs && msgs.length ? msgs[0] : null;
            if (!last?.id) return null;

            // For t.me/c links, internal id is usually the channel/supergroup id without -100 prefix.
            // GramJS entity.id is already the "internal id" used in /c/ links for supergroups/channels.
            const internalId = String(entity.id);
            return `https://t.me/c/${internalId}/${last.id}`;
        } catch (e) {
            return null;
        }
    }

    // Basic private groups (Chat) without username: no reliable link without invite
    return null;
}

function mapDialogBase(dialog, link) {
    const entity = dialog.entity || {};
    return {
        id: String(entity.id ?? ""),
        title: dialog.title || entity.title || "Untitled",
        type: dialog.isChannel ? (entity.broadcast ? "channel" : "supergroup") : (dialog.isGroup ? "group" : "chat"),
        username: entity.username ? String(entity.username) : "",
        link: link || "",
        isCreator: Boolean(entity.creator), // TL flags [web:265]
        isLeft: Boolean(entity.left),       // TL flags [web:265]
    };
}

async function clearTelegramLogin(user_id) {
    await user_setting_module.updateOne(
        { user_id },
        {
            $set: {
                "telegram_login.phone": null,
                "telegram_login.phone_code_hash": null,
                "telegram_login.pending_session_string": null,
                "telegram_login.stage": null,
                "telegram_login.created_at": null,
                "telegram_login.otp_verified_at": null,
                "telegram_login.expires_at": null
            }
        }
    );
}

app.use(express.static(path.join(__dirname, '..', "public")))
app.use(expressEjsLayouts);

app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, '..', 'public', 'views'));
app.set('layout', path.resolve(__dirname, '..', 'public', 'views', 'layout'));

app.get('/group-help-advance', (req, res) => {
    res.render('pages/home', {
        developer_telegram_username,
        token: group_help_advance_token
    })
})

app.get('/group-help-advance/adsgram-reward', (req, res) => {
    res.json({ status: "success", message: "AdsGram reward sended to user." })
})

app.get('/group-help-advance/html_message_design', (req, res) => {
    const { placeholders } = req.query;
    res.render('pages/html_message_design', {
        developer_telegram_username,
        placeholders: placeholders === 'true' ? true : false,
        token: group_help_advance_token
    })
})

app.get('/group-help-advance/buttons-design', (req, res) => {
    res.render('pages/btn_design', {
        developer_telegram_username,
        token: group_help_advance_token
    })
})

app.get("/group-help-advance/privacy-policy", (req, res) => {
    res.render("pages/privacy_policy", {
        developer_telegram_username,
        botName: "Group Help Advance Bot",
        botHandle: "@Group_help_advanced_bot",
        brandName: "Group Help Advance",
        supportTelegram: "https://t.me/EarningPlaner_community_support",
        ownerName: "Earning Planer IT Services",
        ownerAddress: "Jaipur, Rajasthan, IN",
        lastUpdated: "December 29, 2025",
        token: group_help_advance_token,
        botLogoUrl: "https://res.cloudinary.com/dm8miilli/image/upload/t_fdfsd/v1767181841/Untitled_design_bildro.png"
    });
});

app.get("/group-help-advance/find-groups-channels", async (req, res) => {
    const { user_id } = req.query;

    const user_data = await user_setting_module.findOne({ user_id });
    const sessionString = user_data?.user_session_string;

    if (!sessionString) {
        return res.render("pages/login_telegram", {
            developer_telegram_username,
            token: group_help_advance_token,
            user_id,
        });
    }

    const { ok, client, me } = await validateSessionAndGetClient(sessionString);
    if (!ok) {
        return res.render("pages/login_telegram", {
            developer_telegram_username,
            token: group_help_advance_token,
            user_id,
        });
    }

    try {
        const dialogs = await client.getDialogs(); // dialogs list [web:258]

        const joinedMember = [];
        const ownerActive = [];

        for (const d of dialogs) {
            if (!d.isGroup && !d.isChannel) continue;

            const link = await buildChatLink(client, d);
            const item = mapDialogBase(d, link);

            // A) Member (joined) => not creator AND not left
            if (!item.isCreator && !item.isLeft) joinedMember.push(item);

            // B) Created/Owner AND still in group/channel
            if (item.isCreator && !item.isLeft) ownerActive.push(item);

            // C removed: Created/Owner but left
        }

        return res.render("pages/find_groups_and_channels", {
            developer_telegram_username,
            token: group_help_advance_token,
            user_id,
            me: {
                id: String(me.id),
                username: me.username || "",
                firstName: me.firstName || "",
                lastName: me.lastName || "",
                phone: me.phone || "",
                isBot: !!me.bot,
                isPremium: !!me.premium,
            },
            lists: {
                joinedMember,
                ownerActive,
            },
        });
    } catch (e) {
        return res.status(500).send("Failed to load groups/channels. Please try again.");
    } finally {
        await closeClient(client);
    }
});

app.post("/group-help-advance/send-telegram-otp", async (req, res) => {
    try {
        const { user_id, phone } = req.body || {};

        if (!user_id) return res.status(400).json({ success: false, message: "user_id is required" });
        if (!phone || typeof phone !== "string" || !phone.trim().startsWith("+")) {
            return res.status(400).json({ success: false, message: "Phone must be in international format, e.g. +91..." });
        }

        // clear old pending state
        await clearTelegramLogin(user_id);

        const client = buildClient(""); // empty StringSession
        await client.connect();

        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phone.trim(),
                apiId,
                apiHash,
                settings: new Api.CodeSettings({
                    allowFlashcall: false,
                    currentNumber: true,
                    allowAppHash: true,
                }),
            })
        ); // returns phone_code_hash used later 

        const pendingSessionString = client.session.save();

        // Telegram may provide timeout; fallback 300s 
        const timeoutSec = Number(result?.timeout || 300);
        const expiresAt = new Date(Date.now() + Math.max(60, timeoutSec) * 1000);

        await user_setting_module.updateOne(
            { user_id },
            {
                $set: {
                    "telegram_login.phone": phone.trim(),
                    "telegram_login.phone_code_hash": result.phoneCodeHash,
                    "telegram_login.pending_session_string": pendingSessionString,
                    "telegram_login.stage": "OTP_SENT",
                    "telegram_login.created_at": new Date(),
                    "telegram_login.expires_at": expiresAt,
                }
            },
            { upsert: true }
        );

        await closeClient(client);
        return res.json({ success: true, message: "OTP sent. Please enter OTP to verify." });
    } catch (err) {
        return res.status(500).json({ success: false, message: err?.message || "Failed to send OTP" });
    }
});

app.post("/group-help-advance/verify-telegram-otp", async (req, res) => {
    try {
        const { user_id, phone, otp } = req.body || {};

        if (!user_id) return res.status(400).json({ success: false, message: "user_id is required" });
        if (!phone) return res.status(400).json({ success: false, message: "phone is required" });
        if (!otp) return res.status(400).json({ success: false, message: "otp is required" });

        const user = await user_setting_module.findOne({ user_id }).lean();
        const tl = user?.telegram_login;

        if (!tl?.pending_session_string || !tl?.phone_code_hash) {
            return res.status(400).json({ success: false, message: "OTP request not found. Please send OTP first." });
        }
        if (String(tl.phone) !== String(phone).trim()) {
            return res.status(400).json({ success: false, message: "Phone mismatch. Tap Incorrect? and send OTP again." });
        }
        if (tl.expires_at && new Date(tl.expires_at) < new Date()) {
            await clearTelegramLogin(user_id);
            return res.status(410).json({ success: false, message: "OTP expired. Please send OTP again." });
        }

        const client = buildClient(tl.pending_session_string);
        await client.connect();

        try {
            await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: String(phone).trim(),
                    phoneCodeHash: tl.phone_code_hash,
                    phoneCode: String(otp).trim(),
                })
            ); // if too late -> PHONE_CODE_EXPIRED

            const sessionString = client.session.save();

            await user_setting_module.updateOne(
                { user_id },
                {
                    $set: { user_session_string: sessionString },
                }
            );

            await clearTelegramLogin(user_id);

            await closeClient(client);
            return res.json({ success: true, two_step_required: false, message: "Login successful" });
        } catch (err) {
            if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
                // 2FA required, keep pending session for next endpoint
                const pendingSessionString = client.session.save();

                await user_setting_module.updateOne(
                    { user_id },
                    {
                        $set: {
                            "telegram_login.pending_session_string": pendingSessionString,
                            "telegram_login.stage": "TWO_FA",
                            "telegram_login.otp_verified_at": new Date(),
                            // extend time for password step (policy)
                            "telegram_login.expires_at": new Date(Date.now() + 15 * 60 * 1000),
                        }
                    }
                );

                await closeClient(client);
                return res.json({ success: true, two_step_required: true, message: "Two-step verification required" });
            }

            const msg = err?.errorMessage || err?.message || "OTP verification failed";
            return res.status(400).json({ success: false, message: msg });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: safeMsg(err) });
    }
});

app.post("/group-help-advance/validate-telegram-two-step-verification", async (req, res) => {
    try {
        const { user_id, phone, password } = req.body || {};

        if (!user_id) return res.status(400).json({ success: false, message: "user_id is required" });
        if (!phone) return res.status(400).json({ success: false, message: "phone is required" });
        if (!password) return res.status(400).json({ success: false, message: "password is required" });

        const user = await user_setting_module.findOne({ user_id }).lean();
        const tl = user?.telegram_login;

        if (!tl?.pending_session_string || tl?.stage !== "TWO_FA") {
            return res.status(400).json({ success: false, message: "2-step verification is not pending. Verify OTP first." });
        }
        if (String(tl.phone) !== String(phone).trim()) {
            return res.status(400).json({ success: false, message: "Phone mismatch. Tap Incorrect? and send OTP again." });
        }
        if (tl.expires_at && new Date(tl.expires_at) < new Date()) {
            await clearTelegramLogin(user_id);
            return res.status(410).json({ success: false, message: "Login session expired. Please resend OTP." });
        }

        const client = buildClient(tl.pending_session_string);
        await client.connect();

        try {
            await client.signInWithPassword(
                { apiId, apiHash },
                { password: async () => String(password).trim() }
            ); // internally uses auth.checkPassword (SRP) 

            const sessionString = client.session.save();

            await user_setting_module.updateOne(
                { user_id },
                { $set: { user_session_string: sessionString } }
            );

            await clearTelegramLogin(user_id);

            await closeClient(client);
            return res.json({ success: true, message: "Login successful" });
        } catch (err) {
            const msg = err?.errorMessage || err?.message || "Two-step verification failed";
            if (String(msg).includes("PASSWORD_HASH_INVALID") || String(msg).includes("authParams.onError")) {
                return res.status(401).json({ success: false, message: "Incorrect 2-step verification password" });
            }
            return res.status(400).json({ success: false, message: msg });
        }
    } catch (err) {
        return res.status(500).json({ success: false, message: safeMsg(err) });
    }
});

module.exports = app