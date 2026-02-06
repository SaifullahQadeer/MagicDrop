import nodemailer from "nodemailer";
import db from "../db.server";

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send a magic link email to a customer with their download links.
 */
export async function sendMagicLinkEmail({
  shop,
  customerEmail,
  customerName,
  orderName,
  magicLinks,
}) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const subject = settings?.emailSubject || "Your download is ready!";
  const bodyIntro =
    settings?.emailBody ||
    "Thank you for your purchase! Click the links below to download your files.";
  const brandColor = settings?.brandColor || "#5C6AC4";
  const appUrl = process.env.APP_URL || "https://your-app-url.com";

  const fileRows = magicLinks
    .map(
      (link) => `
      <tr>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
          <strong>${escapeHtml(link.file.originalName)}</strong><br/>
          <span style="color: #6b7280; font-size: 13px;">
            ${formatFileSize(link.file.fileSize)} &middot;
            ${link.maxDownloads} downloads allowed &middot;
            Expires ${formatDate(link.expiresAt)}
          </span>
        </td>
        <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: right;">
          <a href="${appUrl}/download/${link.token}"
             style="display: inline-block; padding: 8px 20px; background: ${brandColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
            Download
          </a>
        </td>
      </tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="background: ${brandColor}; padding: 24px 32px;">
        <h1 style="margin: 0; color: white; font-size: 22px;">MagicDrop</h1>
      </div>
      <div style="padding: 32px;">
        <p style="margin: 0 0 8px; font-size: 16px; color: #111827;">
          Hi${customerName ? ` ${escapeHtml(customerName)}` : ""},
        </p>
        <p style="margin: 0 0 24px; font-size: 15px; color: #374151; line-height: 1.5;">
          ${escapeHtml(bodyIntro)}
          ${orderName ? ` (Order ${escapeHtml(orderName)})` : ""}
        </p>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px;">
          ${fileRows}
        </table>
        <p style="margin: 24px 0 0; font-size: 13px; color: #9ca3af; line-height: 1.5;">
          These links are unique to you. Please do not share them.
          Each link has a limited number of downloads and will expire automatically.
        </p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const mail = getTransporter();
  await mail.sendMail({
    from: process.env.EMAIL_FROM || "MagicDrop <noreply@example.com>",
    to: customerEmail,
    subject: `${subject}${orderName ? ` - ${orderName}` : ""}`,
    html,
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
