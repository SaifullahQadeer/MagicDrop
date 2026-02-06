import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  IndexTable,
  Badge,
  Box,
  InlineGrid,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Aggregate stats
  const [fileCount, linkCount, downloadCount, activeLinks, recentDownloads] =
    await Promise.all([
      db.digitalFile.count({ where: { shop } }),
      db.magicLink.count({ where: { shop } }),
      db.download.count({
        where: { magicLink: { shop } },
      }),
      db.magicLink.count({
        where: {
          shop,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
      db.download.findMany({
        where: { magicLink: { shop } },
        include: {
          magicLink: {
            include: { file: true },
          },
        },
        orderBy: { downloadedAt: "desc" },
        take: 10,
      }),
    ]);

  // Recent magic links
  const recentLinks = await db.magicLink.findMany({
    where: { shop },
    include: { file: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return json({
    stats: { fileCount, linkCount, downloadCount, activeLinks },
    recentDownloads,
    recentLinks,
  });
};

export default function DashboardPage() {
  const { stats, recentDownloads, recentLinks } = useLoaderData();

  return (
    <Page title="MagicDrop Dashboard">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatCard label="Digital Files" value={stats.fileCount} />
            <StatCard label="Total Links" value={stats.linkCount} />
            <StatCard label="Active Links" value={stats.activeLinks} />
            <StatCard label="Total Downloads" value={stats.downloadCount} />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Recent Downloads
                </Text>
                <Button url="/app/links" variant="plain">
                  View all links
                </Button>
              </InlineStack>
              <Divider />
              {recentDownloads.length === 0 ? (
                <Box padding="400">
                  <Text tone="subdued" alignment="center">
                    No downloads yet. Downloads will appear here when customers
                    use their magic links.
                  </Text>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: "download",
                    plural: "downloads",
                  }}
                  itemCount={recentDownloads.length}
                  headings={[
                    { title: "File" },
                    { title: "Customer" },
                    { title: "Order" },
                    { title: "Downloaded" },
                  ]}
                  selectable={false}
                >
                  {recentDownloads.map((dl, index) => (
                    <IndexTable.Row id={dl.id} key={dl.id} position={index}>
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="bold">
                          {dl.magicLink.file.originalName}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {dl.magicLink.customerEmail}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {dl.magicLink.orderName || dl.magicLink.orderId}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {new Date(dl.downloadedAt).toLocaleString()}
                        </Text>
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
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">
                  Recent Magic Links
                </Text>
                <Button url="/app/files" variant="plain">
                  Manage files
                </Button>
              </InlineStack>
              <Divider />
              {recentLinks.length === 0 ? (
                <Box padding="400">
                  <Text tone="subdued" alignment="center">
                    No magic links generated yet. Upload files, link them to
                    products, and links will be created automatically on
                    purchase.
                  </Text>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: "link",
                    plural: "links",
                  }}
                  itemCount={recentLinks.length}
                  headings={[
                    { title: "File" },
                    { title: "Customer" },
                    { title: "Downloads" },
                    { title: "Status" },
                  ]}
                  selectable={false}
                >
                  {recentLinks.map((link, index) => {
                    const isExpired = new Date() > new Date(link.expiresAt);
                    const isRevoked = !!link.revokedAt;
                    const isExhausted =
                      link.downloadCount >= link.maxDownloads;

                    let badge;
                    if (isRevoked)
                      badge = <Badge tone="critical">Revoked</Badge>;
                    else if (isExpired) badge = <Badge>Expired</Badge>;
                    else if (isExhausted)
                      badge = <Badge tone="warning">Limit reached</Badge>;
                    else badge = <Badge tone="success">Active</Badge>;

                    return (
                      <IndexTable.Row
                        id={link.id}
                        key={link.id}
                        position={index}
                      >
                        <IndexTable.Cell>
                          <Text variant="bodySm">
                            {link.file.originalName}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm">{link.customerEmail}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm">
                            {link.downloadCount} / {link.maxDownloads}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{badge}</IndexTable.Cell>
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

function StatCard({ label, value }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text variant="headingXl" as="p" fontWeight="bold">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}
