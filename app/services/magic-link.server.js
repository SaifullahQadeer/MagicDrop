import { randomBytes } from "crypto";
import db from "../db.server";
import { sendMagicLinkEmail } from "./email.server";

/**
 * Generate a cryptographically secure token for magic links.
 */
function generateToken() {
  return randomBytes(32).toString("hex");
}

/**
 * Generate magic links for all digital files in an order and send email.
 */
export async function generateMagicLinksForOrder({
  shop,
  order,
  productLinks,
  customerEmail,
  customerName,
}) {
  if (!customerEmail) {
    console.error("No customer email for order", order.id);
    return;
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  const expiryHours = settings?.defaultExpiryHours || 72;
  const maxDownloads = settings?.defaultMaxDownloads || 3;

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  const orderId = String(order.id);
  const orderName = order.name || `#${order.order_number}`;

  const magicLinks = [];

  for (const link of productLinks) {
    const token = generateToken();

    const magicLink = await db.magicLink.create({
      data: {
        shop,
        token,
        fileId: link.fileId,
        orderId,
        orderName,
        customerEmail,
        customerName: customerName || null,
        maxDownloads,
        expiresAt,
      },
      include: { file: true },
    });

    magicLinks.push(magicLink);
  }

  if (magicLinks.length > 0) {
    try {
      await sendMagicLinkEmail({
        shop,
        customerEmail,
        customerName,
        orderName,
        magicLinks,
      });
    } catch (error) {
      console.error("Failed to send magic link email:", error);
    }
  }

  return magicLinks;
}

/**
 * Validate a magic link token and return the link if valid.
 */
export async function validateMagicLink(token) {
  const magicLink = await db.magicLink.findUnique({
    where: { token },
    include: { file: true },
  });

  if (!magicLink) {
    return { valid: false, error: "Link not found" };
  }

  if (magicLink.revokedAt) {
    return { valid: false, error: "This link has been revoked" };
  }

  if (new Date() > magicLink.expiresAt) {
    return { valid: false, error: "This link has expired" };
  }

  if (magicLink.downloadCount >= magicLink.maxDownloads) {
    return { valid: false, error: "Download limit reached" };
  }

  return { valid: true, magicLink };
}

/**
 * Record a download event and increment the counter.
 */
export async function recordDownload(magicLinkId, ipAddress, userAgent) {
  await db.$transaction([
    db.download.create({
      data: {
        magicLinkId,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    }),
    db.magicLink.update({
      where: { id: magicLinkId },
      data: { downloadCount: { increment: 1 } },
    }),
  ]);
}

/**
 * Revoke a magic link so it can no longer be used.
 */
export async function revokeMagicLink(id) {
  return db.magicLink.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

/**
 * Regenerate a magic link with a new token and reset download count.
 */
export async function regenerateMagicLink(id, newExpiryHours) {
  const existing = await db.magicLink.findUnique({ where: { id } });
  if (!existing) throw new Error("Magic link not found");

  const settings = await db.shopSettings.findUnique({
    where: { shop: existing.shop },
  });
  const expiryHours = newExpiryHours || settings?.defaultExpiryHours || 72;
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  return db.magicLink.update({
    where: { id },
    data: {
      token: generateToken(),
      downloadCount: 0,
      expiresAt,
      revokedAt: null,
    },
  });
}
