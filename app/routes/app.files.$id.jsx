import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Banner,
  IndexTable,
  Divider,
  Box,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const file = await db.digitalFile.findFirst({
    where: { id: params.id, shop },
    include: {
      productLinks: true,
      magicLinks: {
        include: { _count: { select: { downloads: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!file) {
    throw new Response("File not found", { status: 404 });
  }

  return json({ file });
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "link-product") {
    // This action will be triggered after the Shopify resource picker
    const productData = formData.get("productData");
    if (!productData) {
      return json({ error: "No product selected" }, { status: 400 });
    }

    const products = JSON.parse(productData);

    for (const product of products) {
      const existing = await db.productFileLink.findFirst({
        where: {
          shopifyProductId: product.id,
          shopifyVariantId: product.variantId || null,
          fileId: params.id,
        },
      });

      if (!existing) {
        await db.productFileLink.create({
          data: {
            shop,
            shopifyProductId: product.id,
            shopifyVariantId: product.variantId || null,
            productTitle: product.title,
            variantTitle: product.variantTitle || null,
            fileId: params.id,
          },
        });
      }
    }

    return json({ success: true, message: "Products linked successfully" });
  }

  if (intent === "unlink-product") {
    const linkId = formData.get("linkId");
    await db.productFileLink.deleteMany({
      where: { id: linkId, shop },
    });
    return json({ success: true, message: "Product unlinked" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function FileDetailPage() {
  const { file } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleProductPicker = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: true,
        action: "select",
      });

      if (selected && selected.length > 0) {
        const products = selected.map((product) => ({
          id: product.id,
          title: product.title,
          variantId: product.variants?.[0]?.id || null,
          variantTitle: product.variants?.[0]?.title || null,
        }));

        const formData = new FormData();
        formData.append("intent", "link-product");
        formData.append("productData", JSON.stringify(products));
        submit(formData, { method: "post" });
      }
    } catch (error) {
      console.error("Resource picker error:", error);
    }
  }, [submit]);

  const handleUnlink = useCallback(
    (linkId) => {
      const formData = new FormData();
      formData.append("intent", "unlink-product");
      formData.append("linkId", linkId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  return (
    <Page
      backAction={{ content: "Files", url: "/app/files" }}
      title={file.originalName}
      subtitle={`${formatFileSize(file.fileSize)} · ${file.mimeType}`}
    >
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
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Linked Products
                </Text>
                <Button onClick={handleProductPicker}>Link product</Button>
              </InlineStack>
              <Divider />
              {file.productLinks.length === 0 ? (
                <Box padding="400">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text tone="subdued">No products linked yet.</Text>
                    <Text variant="bodySm" tone="subdued">
                      Link this file to Shopify products so customers
                      automatically receive download links after purchase.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: "product",
                    plural: "products",
                  }}
                  itemCount={file.productLinks.length}
                  headings={[
                    { title: "Product" },
                    { title: "Variant" },
                    { title: "Linked" },
                    { title: "" },
                  ]}
                  selectable={false}
                >
                  {file.productLinks.map((link, index) => (
                    <IndexTable.Row
                      id={link.id}
                      key={link.id}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="bold">
                          {link.productTitle}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {link.variantTitle || "All variants"}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {new Date(link.createdAt).toLocaleDateString()}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button
                          icon={DeleteIcon}
                          tone="critical"
                          variant="plain"
                          onClick={() => handleUnlink(link.id)}
                        />
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Recent Magic Links
              </Text>
              <Divider />
              {file.magicLinks.length === 0 ? (
                <Box padding="400">
                  <Text tone="subdued">
                    No magic links generated yet. Links are created
                    automatically when a customer purchases a linked product.
                  </Text>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: "magic link",
                    plural: "magic links",
                  }}
                  itemCount={file.magicLinks.length}
                  headings={[
                    { title: "Customer" },
                    { title: "Order" },
                    { title: "Downloads" },
                    { title: "Status" },
                    { title: "Expires" },
                  ]}
                  selectable={false}
                >
                  {file.magicLinks.map((link, index) => {
                    const isExpired = new Date() > new Date(link.expiresAt);
                    const isRevoked = !!link.revokedAt;
                    const isExhausted =
                      link.downloadCount >= link.maxDownloads;

                    let status;
                    if (isRevoked) status = <Badge tone="critical">Revoked</Badge>;
                    else if (isExpired) status = <Badge>Expired</Badge>;
                    else if (isExhausted)
                      status = <Badge tone="warning">Limit reached</Badge>;
                    else status = <Badge tone="success">Active</Badge>;

                    return (
                      <IndexTable.Row
                        id={link.id}
                        key={link.id}
                        position={index}
                      >
                        <IndexTable.Cell>
                          <Text variant="bodySm">{link.customerEmail}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm">
                            {link.orderName || link.orderId}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm">
                            {link.downloadCount} / {link.maxDownloads}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{status}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm">
                            {new Date(link.expiresAt).toLocaleDateString()}
                          </Text>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
