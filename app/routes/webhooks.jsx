import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generateMagicLinksForOrder } from "../services/magic-link.server";

export const action = async ({ request }) => {
  const { topic, shop, session, admin, payload } =
    await authenticate.webhook(request);

  if (!admin) {
    throw new Response();
  }

  switch (topic) {
    case "ORDERS_CREATE":
      await handleOrderCreate(shop, payload, admin);
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

async function handleOrderCreate(shop, payload, admin) {
  const order = payload;
  const lineItems = order.line_items || [];

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
        ...(variantId ? { shopifyVariantId: variantId } : {}),
      },
      include: { file: true },
    });

    if (productLinks.length > 0) {
      await generateMagicLinksForOrder({
        shop,
        order,
        productLinks,
        customerEmail: order.email,
        customerName: `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
      });
    }
  }
}
