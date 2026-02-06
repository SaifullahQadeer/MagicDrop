import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Button,
  Banner,
  Text,
  Divider,
  FormLayout,
  Select,
  InlineStack,
  Badge,
  IndexTable,
  Box,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { generateMagicLinksForOrder } from "../services/magic-link.server";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await db.shopSettings.create({ data: { shop } });
  }

  // Check webhook status
  let webhooks = [];
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
    webhooks = data.data.webhookSubscriptions.edges.map((e) => ({
      id: e.node.id,
      topic: e.node.topic,
      url: e.node.endpoint?.callbackUrl || "N/A",
    }));
  } catch (error) {
    console.error("Failed to fetch webhooks:", error.message);
  }

  // Check system status
  const status = {
    database: "connected",
    fileCount: await db.digitalFile.count({ where: { shop } }),
    linkCount: await db.magicLink.count({ where: { shop } }),
    productLinkCount: await db.productFileLink.count({ where: { shop } }),
    s3Bucket: process.env.S3_BUCKET_NAME || "NOT SET",
    smtpHost: process.env.SMTP_HOST || "NOT SET",
    emailFrom: process.env.EMAIL_FROM || "NOT SET",
    appUrl: process.env.SHOPIFY_APP_URL || "NOT SET",
  };

  return json({ settings, webhooks, status });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  // Register webhook
  if (intent === "register-webhook") {
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
            }
            userErrors {
              field
              message
            }
          }
        }
      `);
      const data = await response.json();
      const result = data.data.webhookSubscriptionCreate;
      if (result.userErrors.length > 0) {
        return json({ error: `Webhook error: ${result.userErrors.map(e => e.message).join(", ")}` });
      }
      return json({ success: true, message: "Webhook registered successfully!" });
    } catch (error) {
      return json({ error: `Failed to register webhook: ${error.message}` });
    }
  }

  // Process order manually
  if (intent === "process-order") {
    const orderNumber = formData.get("orderNumber");
    if (!orderNumber) {
      return json({ error: "Please enter an order number" });
    }

    try {
      // Fetch order from Shopify
      const response = await admin.graphql(`
        query($query: String!) {
          orders(first: 1, query: $query) {
            edges {
              node {
                id
                name
                email
                customer {
                  firstName
                  lastName
                }
                lineItems(first: 50) {
                  edges {
                    node {
                      product {
                        id
                      }
                      variant {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `, {
        variables: { query: `name:#${orderNumber.replace('#', '')}` },
      });

      const data = await response.json();
      const orders = data.data.orders.edges;

      if (orders.length === 0) {
        return json({ error: `Order #${orderNumber.replace('#', '')} not found` });
      }

      const order = orders[0].node;
      let totalLinks = 0;

      for (const item of order.lineItems.edges) {
        const productId = item.node.product?.id;
        const variantId = item.node.variant?.id;
        if (!productId) continue;

        const productLinks = await db.productFileLink.findMany({
          where: {
            shop,
            shopifyProductId: productId,
          },
          include: { file: true },
        });

        if (productLinks.length > 0) {
          await generateMagicLinksForOrder({
            shop,
            order: {
              id: order.id,
              name: order.name,
              email: order.email,
            },
            productLinks,
            customerEmail: order.email,
            customerName: `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim(),
          });
          totalLinks += productLinks.length;
        }
      }

      if (totalLinks === 0) {
        return json({ error: `No linked digital files found for order ${order.name}. Make sure the products in this order are linked to digital files.` });
      }

      return json({ success: true, message: `Generated ${totalLinks} magic link(s) for ${order.name}! Check Magic Links page and customer email.` });
    } catch (error) {
      return json({ error: `Failed to process order: ${error.message}` });
    }
  }

  // Save settings
  const defaultExpiryHours = parseInt(formData.get("defaultExpiryHours") || "72");
  const defaultMaxDownloads = parseInt(formData.get("defaultMaxDownloads") || "3");
  const emailSubject = formData.get("emailSubject") || "Your download is ready!";
  const emailBody = formData.get("emailBody") || "Thank you for your purchase!";
  const brandColor = formData.get("brandColor") || "#5C6AC4";

  if (defaultExpiryHours < 1 || defaultExpiryHours > 8760) {
    return json({ error: "Expiry hours must be between 1 and 8760" }, { status: 400 });
  }
  if (defaultMaxDownloads < 1 || defaultMaxDownloads > 100) {
    return json({ error: "Max downloads must be between 1 and 100" }, { status: 400 });
  }

  await db.shopSettings.upsert({
    where: { shop },
    update: { defaultExpiryHours, defaultMaxDownloads, emailSubject, emailBody, brandColor },
    create: { shop, defaultExpiryHours, defaultMaxDownloads, emailSubject, emailBody, brandColor },
  });

  return json({ success: true, message: "Settings saved" });
};

export default function SettingsPage() {
  const { settings, webhooks, status } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSaving = navigation.state === "submitting";

  const [expiryHours, setExpiryHours] = useState(String(settings.defaultExpiryHours));
  const [maxDownloads, setMaxDownloads] = useState(String(settings.defaultMaxDownloads));
  const [emailSubject, setEmailSubject] = useState(settings.emailSubject);
  const [emailBody, setEmailBody] = useState(settings.emailBody);
  const [brandColor, setBrandColor] = useState(settings.brandColor);
  const [orderNumber, setOrderNumber] = useState("");

  const hasOrdersCreate = webhooks.some((w) => w.topic === "ORDERS_CREATE");

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("defaultExpiryHours", expiryHours);
    formData.append("defaultMaxDownloads", maxDownloads);
    formData.append("emailSubject", emailSubject);
    formData.append("emailBody", emailBody);
    formData.append("brandColor", brandColor);
    submit(formData, { method: "post" });
  }, [expiryHours, maxDownloads, emailSubject, emailBody, brandColor, submit]);

  const handleRegisterWebhook = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "register-webhook");
    submit(formData, { method: "post" });
  }, [submit]);

  const handleProcessOrder = useCallback(() => {
    if (!orderNumber) return;
    const formData = new FormData();
    formData.append("intent", "process-order");
    formData.append("orderNumber", orderNumber);
    submit(formData, { method: "post" });
  }, [orderNumber, submit]);

  const expiryOptions = [
    { label: "1 hour", value: "1" },
    { label: "6 hours", value: "6" },
    { label: "24 hours (1 day)", value: "24" },
    { label: "48 hours (2 days)", value: "48" },
    { label: "72 hours (3 days)", value: "72" },
    { label: "168 hours (7 days)", value: "168" },
    { label: "720 hours (30 days)", value: "720" },
    { label: "Custom", value: "custom" },
  ];

  const isCustomExpiry = !expiryOptions.some((opt) => opt.value === expiryHours);

  return (
    <Page title="Settings">
      <Layout>
        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success">{actionData.message}</Banner>
          </Layout.Section>
        )}

        {/* System Status */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">System Status</Text>
              <Divider />
              <InlineStack gap="400" wrap>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Database</Text>
                  <Badge tone="success">Connected</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Digital Files</Text>
                  <Badge>{status.fileCount}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Product Links</Text>
                  <Badge>{status.productLinkCount}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Magic Links</Text>
                  <Badge>{status.linkCount}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">S3 Bucket</Text>
                  <Badge tone={status.s3Bucket !== "NOT SET" ? "success" : "critical"}>
                    {status.s3Bucket !== "NOT SET" ? "Configured" : "Not Set"}
                  </Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Email (SMTP)</Text>
                  <Badge tone={status.smtpHost !== "NOT SET" ? "success" : "critical"}>
                    {status.smtpHost !== "NOT SET" ? "Configured" : "Not Set"}
                  </Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Webhook</Text>
                  <Badge tone={hasOrdersCreate ? "success" : "critical"}>
                    {hasOrdersCreate ? "Registered" : "Not Registered"}
                  </Badge>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Webhook Management */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">Webhook Management</Text>
                <Button onClick={handleRegisterWebhook} loading={isSaving}>
                  {hasOrdersCreate ? "Re-register" : "Register Webhook"}
                </Button>
              </InlineStack>
              <Divider />
              {webhooks.length === 0 ? (
                <Banner tone="warning">
                  No webhooks registered. Click "Register Webhook" to enable automatic
                  magic link generation when orders are placed.
                </Banner>
              ) : (
                <BlockStack gap="200">
                  {webhooks.map((w) => (
                    <InlineStack key={w.id} gap="300" blockAlign="center">
                      <Badge tone="success">{w.topic}</Badge>
                      <Text variant="bodySm" tone="subdued">{w.url}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Manual Order Processing */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Manual Order Processing</Text>
              <Text variant="bodySm" tone="subdued">
                Manually generate magic links for an existing order. Use this to test
                or to process orders that were placed before webhooks were set up.
              </Text>
              <Divider />
              <InlineStack gap="300" blockAlign="end">
                <div style={{ flex: 1 }}>
                  <TextField
                    label="Order number"
                    value={orderNumber}
                    onChange={setOrderNumber}
                    placeholder="1016"
                    autoComplete="off"
                    helpText="Enter the order number (e.g., 1016)"
                  />
                </div>
                <Button onClick={handleProcessOrder} loading={isSaving} variant="primary">
                  Process Order
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Magic Link Defaults */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Magic Link Defaults</Text>
              <Divider />
              <FormLayout>
                {isCustomExpiry ? (
                  <TextField label="Link expiry (hours)" type="number" value={expiryHours} onChange={setExpiryHours} min={1} max={8760} autoComplete="off" />
                ) : (
                  <Select label="Link expiry" options={expiryOptions} value={expiryHours} onChange={setExpiryHours} />
                )}
                <TextField label="Maximum downloads per link" type="number" value={maxDownloads} onChange={setMaxDownloads} min={1} max={100} autoComplete="off" />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Email Customization */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Email Customization</Text>
              <Divider />
              <FormLayout>
                <TextField label="Email subject" value={emailSubject} onChange={setEmailSubject} autoComplete="off" />
                <TextField label="Email body" value={emailBody} onChange={setEmailBody} multiline={4} autoComplete="off" />
                <TextField
                  label="Brand color"
                  value={brandColor}
                  onChange={setBrandColor}
                  autoComplete="off"
                  prefix={<div style={{ width: 20, height: 20, borderRadius: 4, background: brandColor, border: "1px solid #ddd" }} />}
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="end">
            <Button variant="primary" onClick={handleSave} loading={isSaving}>
              Save settings
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
