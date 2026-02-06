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
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await db.shopSettings.create({
      data: { shop },
    });
  }

  return json({ settings });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();

  const defaultExpiryHours = parseInt(formData.get("defaultExpiryHours") || "72");
  const defaultMaxDownloads = parseInt(formData.get("defaultMaxDownloads") || "3");
  const emailSubject = formData.get("emailSubject") || "Your download is ready!";
  const emailBody =
    formData.get("emailBody") ||
    "Thank you for your purchase! Click the links below to download your files.";
  const brandColor = formData.get("brandColor") || "#5C6AC4";

  if (defaultExpiryHours < 1 || defaultExpiryHours > 8760) {
    return json(
      { error: "Expiry hours must be between 1 and 8760 (1 year)" },
      { status: 400 }
    );
  }

  if (defaultMaxDownloads < 1 || defaultMaxDownloads > 100) {
    return json(
      { error: "Max downloads must be between 1 and 100" },
      { status: 400 }
    );
  }

  const settings = await db.shopSettings.upsert({
    where: { shop },
    update: {
      defaultExpiryHours,
      defaultMaxDownloads,
      emailSubject,
      emailBody,
      brandColor,
    },
    create: {
      shop,
      defaultExpiryHours,
      defaultMaxDownloads,
      emailSubject,
      emailBody,
      brandColor,
    },
  });

  return json({ success: true, message: "Settings saved", settings });
};

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const isSaving = navigation.state === "submitting";

  const [expiryHours, setExpiryHours] = useState(
    String(settings.defaultExpiryHours)
  );
  const [maxDownloads, setMaxDownloads] = useState(
    String(settings.defaultMaxDownloads)
  );
  const [emailSubject, setEmailSubject] = useState(settings.emailSubject);
  const [emailBody, setEmailBody] = useState(settings.emailBody);
  const [brandColor, setBrandColor] = useState(settings.brandColor);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("defaultExpiryHours", expiryHours);
    formData.append("defaultMaxDownloads", maxDownloads);
    formData.append("emailSubject", emailSubject);
    formData.append("emailBody", emailBody);
    formData.append("brandColor", brandColor);
    submit(formData, { method: "post" });
  }, [expiryHours, maxDownloads, emailSubject, emailBody, brandColor, submit]);

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

  const isCustomExpiry = !expiryOptions.some(
    (opt) => opt.value === expiryHours
  );

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

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Magic Link Defaults
              </Text>
              <Text variant="bodySm" tone="subdued">
                These settings apply to all new magic links. Existing links are
                not affected.
              </Text>
              <Divider />
              <FormLayout>
                {isCustomExpiry ? (
                  <TextField
                    label="Link expiry (hours)"
                    type="number"
                    value={expiryHours}
                    onChange={setExpiryHours}
                    min={1}
                    max={8760}
                    helpText="How long download links remain valid (1-8760 hours)"
                    autoComplete="off"
                  />
                ) : (
                  <Select
                    label="Link expiry"
                    options={expiryOptions}
                    value={expiryHours}
                    onChange={setExpiryHours}
                    helpText="How long download links remain valid after purchase"
                  />
                )}
                <TextField
                  label="Maximum downloads per link"
                  type="number"
                  value={maxDownloads}
                  onChange={setMaxDownloads}
                  min={1}
                  max={100}
                  helpText="Number of times a customer can download per link (1-100)"
                  autoComplete="off"
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Email Customization
              </Text>
              <Text variant="bodySm" tone="subdued">
                Customize the email sent to customers with their download links.
              </Text>
              <Divider />
              <FormLayout>
                <TextField
                  label="Email subject"
                  value={emailSubject}
                  onChange={setEmailSubject}
                  autoComplete="off"
                  helpText="The subject line of the download email"
                />
                <TextField
                  label="Email body"
                  value={emailBody}
                  onChange={setEmailBody}
                  multiline={4}
                  autoComplete="off"
                  helpText="The introductory text in the download email"
                />
                <TextField
                  label="Brand color"
                  value={brandColor}
                  onChange={setBrandColor}
                  autoComplete="off"
                  helpText="Hex color for email header and download buttons (e.g. #5C6AC4)"
                  prefix={
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        background: brandColor,
                        border: "1px solid #ddd",
                      }}
                    />
                  }
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineStack align="end">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={isSaving}
            >
              Save settings
            </Button>
          </InlineStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
