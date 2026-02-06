import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const results = { shop: session.shop };

  // 1. Check existing webhook subscriptions
  try {
    const response = await admin.graphql(`
      query {
        webhookSubscriptions(first: 25) {
          edges {
            node {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
          }
        }
      }
    `);
    const data = await response.json();
    results.existingWebhooks = data.data.webhookSubscriptions.edges.map(
      (e) => ({
        id: e.node.id,
        topic: e.node.topic,
        url: e.node.endpoint?.callbackUrl || "N/A",
      })
    );
  } catch (error) {
    results.listError = error.message;
  }

  // 2. Register orders/create webhook if not present
  const hasOrdersCreate = results.existingWebhooks?.some(
    (w) => w.topic === "ORDERS_CREATE"
  );

  if (!hasOrdersCreate) {
    try {
      const appUrl = process.env.SHOPIFY_APP_URL || "https://magic-drop.vercel.app";
      const response = await admin.graphql(`
        mutation {
          webhookSubscriptionCreate(
            topic: ORDERS_CREATE
            webhookSubscription: {
              callbackUrl: "${appUrl}/webhooks"
              format: JSON
            }
          ) {
            webhookSubscription {
              id
              topic
              endpoint {
                __typename
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `);
      const data = await response.json();
      results.registration = data.data.webhookSubscriptionCreate;
    } catch (error) {
      results.registrationError = error.message;
    }
  } else {
    results.registration = "ORDERS_CREATE already registered";
  }

  return json(results);
};
