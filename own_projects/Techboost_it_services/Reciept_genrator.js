// own_projects/Techboost_it_services/Reciept_genrator.js
// Telegraf-compatible receipt generator module
// - Requires: puppeteer, mongoose model at ./models/receipts_model
// - Behavior: /setreceipt (admin only) interactive flow -> creates DB record -> generates PDF in memory -> sends PDF and msg
//             /getreceipt                 -> asks for receipt number -> returns screenshot (if exists) and generated PDF (in-memory)

const puppeteer = require("puppeteer");
const receipts_model = require("./models/receipts_model"); // adjust relative path if your project structure differs

module.exports = (bot) => {
    if (!bot) throw new Error("Telegraf bot instance required");

    const ADMIN_ID = Number(process.env.ADMIN_ID_TECHBOOST_IT_SERVICES || 0);
    if (!ADMIN_ID) {
        console.warn("Warning: ADMIN_ID_TECHBOOST_IT_SERVICES is not set. /setreceipt will be unavailable.");
    }

    // In-memory sessions keyed by chat id
    const sessions = new Map();

    /* ------------------ Helpers ------------------ */

    const isAdminCtx = (ctx) => {
        if (!ADMIN_ID) return false;
        return Number(ctx.from?.id) === ADMIN_ID;
    };

    const escapeHtml = (str = "") => {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    const generateHTML = (d) => {
        const dateStr = new Date(d.createdAt || Date.now()).toLocaleDateString("en-GB");
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Payment Receipt - ${escapeHtml(d.receiptNumber || "")}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background: #f4f6f8; padding: 30px; }
  .receipt-container { max-width: 800px; margin: auto; background: #ffffff; padding: 30px; border: 1px solid #ddd; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 15px; }
  .company-details h2 { margin: 0; color: #1a237e; }
  .company-details p { margin: 3px 0; font-size: 14px; color: #333; }
  .receipt-title h1 { margin: 0; font-size: 28px; color: #333; }
  .section { margin-top: 25px; }
  .section h3 { margin-bottom: 10px; font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 5px; color: #333; }
  table { width:100%; border-collapse: collapse; font-size: 14px; }
  td, th { padding: 8px; border: 1px solid #ddd; }
  .total { text-align: right; font-size: 18px; font-weight: bold; margin-top: 15px; }
  .note { margin-top: 20px; font-size: 13px; color: #444; background: #f9f9f9; padding: 10px; border-left: 4px solid #1a237e; }
  .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 14px; }
  .signature { text-align: right; }
</style>
</head>
<body>
<div class="receipt-container">
  <div class="header">
    <div class="company-details">
      <h2>TechBoost IT Services</h2>
      <p>IT & Digital Solutions Provider</p>
      <p>MSME (Udyam) Registered</p>
      <p>Email: support@techboost.in</p>
      <p>Phone: +91-9XXXXXXXXX</p>
    </div>
    <div class="receipt-title">
      <h1>Payment Receipt</h1>
      <p><strong>Receipt No:</strong> ${escapeHtml(d.receiptNumber || "")}</p>
      <p><strong>Date:</strong> ${escapeHtml(dateStr)}</p>
    </div>
  </div>

  <div class="section">
    <h3>Client Details</h3>
    <table>
      <tr><td><strong>Client Name</strong></td><td>${escapeHtml(d.clientName || "")}</td></tr>
      <tr><td><strong>Client Address</strong></td><td>${escapeHtml(d.clientAddress || "")}</td></tr>
    </table>
  </div>

  <div class="section">
    <h3>Service Details</h3>
    <table>
      <tr><th>Description</th><th>Amount (₹)</th></tr>
      <tr><td>${escapeHtml(d.serviceDescription || "")}</td><td>₹${Number(d.amount || 0).toFixed(2)}</td></tr>
    </table>
    <div class="total">Total Amount Paid: ₹${Number(d.amount || 0).toFixed(2)}</div>
  </div>

  <div class="section">
    <h3>Payment Information</h3>
    <table>
      <tr><td><strong>Payment Mode</strong></td><td>${escapeHtml(d.paymentMode || "")}</td></tr>
      <tr><td><strong>Payment Status</strong></td><td>Received</td></tr>
    </table>
  </div>

  <div class="note">
    <strong>Note:</strong><br>
    GST is not applicable as the service provider is not registered under GST as per current applicable laws.
  </div>

  <div class="footer">
    <div>
      <p><strong>Issued By:</strong></p>
      <p>TechBoost IT Services</p>
    </div>
    <div class="signature">
      <p><strong>Authorized Signatory</strong></p>
      <p>Prem Singh</p>
      <p>(Founder)</p>
    </div>
  </div>
</div>
</body>
</html>`;
    };

    const createPdfBuffer = async (html) => {
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle0" });
            const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
            return pdfBuffer;
        } finally {
            await browser.close();
        }
    };

    /* ------------------ Commands ------------------ */

    // Admin-only: start receipt creation
    bot.command("setreceipt", (ctx) => {
        if (!isAdminCtx(ctx)) {
            return ctx.reply("Unauthorized. Only admin can create receipts.");
        }
        sessions.set(ctx.chat.id, { step: 1, data: {} });
        return ctx.reply("Receipt creation started.\n1) Client Name bhejo:");
    });

    // Public: fetch existing receipt by number
    bot.command("getreceipt", (ctx) => {
        sessions.set(ctx.chat.id, { step: "get" });
        return ctx.reply("Please enter Receipt Number (e.g. TB-2025-0001):");
    });

    /* ------------------ Message handler ------------------ */

    bot.on("message", async (ctx) => {
        try {
            // ignore channel posts and edited messages without message
            if (!ctx.message) return;

            const chatId = ctx.chat.id;
            const session = sessions.get(chatId);
            if (!session) return; // nothing to do

            // if command during session, clear session and exit (command handlers will run separately)
            if (ctx.message.text && ctx.message.text.startsWith("/")) {
                sessions.delete(chatId);
                return;
            }

            // GET flow
            if (session.step === "get") {
                const rnum = (ctx.message.text || "").trim();
                if (!rnum) {
                    sessions.delete(chatId);
                    return ctx.reply("Invalid receipt number.");
                }
                const doc = await receipts_model.findOne({ receiptNumber: rnum }).lean();
                if (!doc) {
                    sessions.delete(chatId);
                    return ctx.reply(`Receipt ${rnum} not found.`);
                }

                // send summary
                const summary = [
                    `Receipt: ${doc.receiptNumber}`,
                    `Date: ${new Date(doc.createdAt).toLocaleString("en-GB")}`,
                    `Client: ${doc.clientName}`,
                    `Amount: ₹${Number(doc.amount).toFixed(2)}`,
                    `Service: ${doc.serviceDescription}`
                ].join("\n");
                await ctx.reply(summary);

                // send stored screenshot if present
                if (doc.paymentScreenshotFileId) {
                    try {
                        await ctx.replyWithPhoto(doc.paymentScreenshotFileId, { caption: "Payment screenshot" });
                    } catch (err) {
                        // ignore errors sending stored file_id
                        console.warn("sendPhoto error:", err && err.message ? err.message : err);
                    }
                }

                // generate PDF on the fly and send
                try {
                    const html = generateHTML(doc);
                    const pdfBuffer = await createPdfBuffer(html);
                    await ctx.replyWithDocument({ source: pdfBuffer, filename: `${doc.receiptNumber}.pdf` });
                } catch (err) {
                    console.error("PDF generation error (get):", err);
                    await ctx.reply("Failed to generate PDF. Try again later.");
                }

                sessions.delete(chatId);
                return;
            }

            // SET flow (admin only)
            if (!isAdminCtx(ctx)) {
                // if someone other than admin somehow is in a set flow, cancel it
                sessions.delete(chatId);
                return ctx.reply("Unauthorized operation. Only admin can use this flow.");
            }

            // sequential states for admin
            switch (session.step) {
                case 1: // client name
                    if (!ctx.message.text) return ctx.reply("Client name text required.");
                    session.data.clientName = ctx.message.text.trim();
                    session.step = 2;
                    sessions.set(chatId, session);
                    return ctx.reply("Client Address bhejo (city/state sufficient):");
                case 2: // client address
                    session.data.clientAddress = ctx.message.text ? ctx.message.text.trim() : "";
                    session.step = 3;
                    sessions.set(chatId, session);
                    return ctx.reply("Service Description (short):");
                case 3: // service description
                    session.data.serviceDescription = ctx.message.text ? ctx.message.text.trim() : "";
                    session.step = 4;
                    sessions.set(chatId, session);
                    return ctx.reply("Amount (numbers only, e.g. 15000):");
                case 4: // amount
                    {
                        const raw = ctx.message.text ? ctx.message.text.replace(/[₹,\s]/g, "") : "";
                        const num = Number(raw);
                        if (!raw || Number.isNaN(num)) {
                            return ctx.reply("Please send a valid numeric amount (e.g. 15000).");
                        }
                        session.data.amount = num;
                        session.step = 5;
                        sessions.set(chatId, session);
                        return ctx.reply("Payment Mode (e.g. UPI / Bank Transfer / Cash):");
                    }
                case 5: // payment mode
                    session.data.paymentMode = ctx.message.text ? ctx.message.text.trim() : "";
                    session.step = 6;
                    sessions.set(chatId, session);
                    return ctx.reply("Now send payment screenshot (photo).");
                case 6: // awaiting photo
                    // handle photos
                    if (ctx.message.photo && ctx.message.photo.length > 0) {
                        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

                        // create DB record (receiptNumber assigned by model pre-validate)
                        let created;
                        try {
                            created = await receipts_model.create({
                                clientName: session.data.clientName,
                                clientAddress: session.data.clientAddress,
                                serviceDescription: session.data.serviceDescription,
                                amount: session.data.amount,
                                paymentMode: session.data.paymentMode,
                                paymentScreenshotFileId: fileId
                                // do not store pdfPath as per requirement
                            });
                        } catch (err) {
                            console.error("DB create error:", err);
                            sessions.delete(chatId);
                            return ctx.reply("Database error while creating receipt. Try again later.");
                        }

                        // generate PDF in-memory
                        try {
                            const html = generateHTML(created);
                            const buffer = await createPdfBuffer(html);

                            // send pdf and confirmation
                            await ctx.replyWithDocument({ source: buffer, filename: `${created.receiptNumber}.pdf` }, { caption: `Receipt created: ${created.receiptNumber}` });
                            await ctx.reply(`Receipt created successfully. Receipt Number: ${created.receiptNumber}`);
                        } catch (err) {
                            console.error("PDF generation/send error:", err);
                            // Note: DB record exists; you may delete if you prefer
                            await ctx.reply("PDF generation or sending failed. Receipt stored in DB; try /getreceipt to fetch.");
                        }

                        sessions.delete(chatId);
                        return;
                    } else {
                        return ctx.reply("Please send a photo (payment screenshot).");
                    }
                default:
                    sessions.delete(chatId);
                    return;
            }
        } catch (err) {
            console.error("Unhandled error in receipt module:", err);
            try { await ctx.reply("Unexpected error occurred. Please try again."); } catch { }
            sessions.delete(ctx.chat.id);
        }
    });
};