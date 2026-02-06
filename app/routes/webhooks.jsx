import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generateMagicLinksForOrder } from "../services/magic-link.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  console.log(`[Webhook] Received topic=${topic} shop=${shop}`);

  switch (topic) {
    case "ORDERS_CREATE":
      console.log(`[Webhook] Processing order: ${payload?.name || payload?.id}`);
      await handleOrderCreate(shop, payload);
      break;
    case "APP_UNINSTALLED":
      if (session) {
        await db.session.deleteMany({ where: { shop } });
      }
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
      // Handle privacy compliance webhooks
      break;
    default:
      throw new Response("Unhandled webhook topic", { status: 404 });
  }

  return new Response();
};

async function handleOrderCreate(shop, payload) {
  const order = payload;
  const lineItems = order.line_items || [];

  console.log(`[Webhook] Order ${order.name || order.id}: ${lineItems.length} line items, email: ${order.email}`);

  let totalLinks = 0;

  for (const item of lineItems) {
    const productId = `gid://shopify/Product/${item.product_id}`;
    const variantId = item.variant_id
      ? `gid://shopify/ProductVariant/${item.variant_id}`
      : null;

    // Find linked digital files for this product/variant
    const productLinks = await db.productFileLink.findMany({
      where: {
        shop,
        shopifyProductId: productId,
      },
      include: { file: true },
    });

    console.log(`[Webhook] Product ${productId}: found ${productLinks.length} file links`);

    if (productLinks.length > 0) {
      await generateMagicLinksForOrder({
        shop,
        order,
        productLinks,
        customerEmail: order.email,
        customerName: `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
      });
      totalLinks += productLinks.length;
    }
  }

  console.log(`[Webhook] Order ${order.name || order.id}: generated ${totalLinks} magic link(s)`);
}
