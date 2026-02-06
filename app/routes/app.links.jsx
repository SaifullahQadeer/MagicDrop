import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useSubmit,
  useSearchParams,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  IndexTable,
  Banner,
  Filters,
  ChoiceList,
  Box,
  Modal,
  EmptyState,
  Pagination,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  revokeMagicLink,
  regenerateMagicLink,
} from "../services/magic-link.server";

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "all";
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1");

  const where = { shop };
  const now = new Date();

  if (status === "active") {
    where.revokedAt = null;
    where.expiresAt = { gt: now };
  } else if (status === "expired") {
    where.expiresAt = { lte: now };
    where.revokedAt = null;
  } else if (status === "revoked") {
    where.revokedAt = { not: null };
  }

  if (search) {
    where.OR = [
      { customerEmail: { contains: search } },
      { orderName: { contains: search } },
      { file: { originalName: { contains: search } } },
    ];
  }

  const [links, totalCount] = await Promise.all([
    db.magicLink.findMany({
      where,
      include: {
        file: true,
        _count: { select: { downloads: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.magicLink.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return json({ links, totalCount, page, totalPages });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  const linkId = formData.get("linkId");

  // Verify ownership
  const link = await db.magicLink.findFirst({
    where: { id: linkId, shop },
  });

  if (!link) {
    return json({ error: "Link not found" }, { status: 404 });
  }

  if (intent === "revoke") {
    await revokeMagicLink(linkId);
    return json({ success: true, message: "Link revoked" });
  }

  if (intent === "regenerate") {
    await regenerateMagicLink(linkId);
    return json({
      success: true,
      message: "Link regenerated with new token and reset download count",
    });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function LinksPage() {
  const { links, totalCount, page, totalPages } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [revokeId, setRevokeId] = useState(null);
  const [regenerateId, setRegenerateId] = useState(null);

  const statusFilter = searchParams.get("status") || "all";
  const searchQuery = searchParams.get("search") || "";

  const handleStatusChange = useCallback(
    (value) => {
      const params = new URLSearchParams(searchParams);
      params.set("status", value[0]);
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleSearchChange = useCallback(
    (value) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      params.set("page", "1");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleRevoke = useCallback(
    (linkId) => {
      const formData = new FormData();
      formData.append("intent", "revoke");
      formData.append("linkId", linkId);
      submit(formData, { method: "post" });
      setRevokeId(null);
    },
    [submit]
  );

  const handleRegenerate = useCallback(
    (linkId) => {
      const formData = new FormData();
      formData.append("intent", "regenerate");
      formData.append("linkId", linkId);
      submit(formData, { method: "post" });
      setRegenerateId(null);
    },
    [submit]
  );

  const handlePagination = useCallback(
    (direction) => {
      const params = new URLSearchParams(searchParams);
      const newPage = direction === "next" ? page + 1 : page - 1;
      params.set("page", String(newPage));
      setSearchParams(params);
    },
    [searchParams, setSearchParams, page]
  );

  const filters = [
    {
      key: "status",
      label: "Status",
      filter: (
        <ChoiceList
          title="Status"
          titleHidden
          choices={[
            { label: "All", value: "all" },
            { label: "Active", value: "active" },
            { label: "Expired", value: "expired" },
            { label: "Revoked", value: "revoked" },
          ]}
          selected={[statusFilter]}
          onChange={handleStatusChange}
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = [];
  if (statusFilter !== "all") {
    appliedFilters.push({
      key: "status",
      label: `Status: ${statusFilter}`,
      onRemove: () => handleStatusChange(["all"]),
    });
  }

  return (
    <Page title="Magic Links" subtitle={`${totalCount} total links`}>
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
          {links.length === 0 && !searchQuery && statusFilter === "all" ? (
            <Card>
              <EmptyState
                heading="No magic links yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Magic links are generated automatically when customers
                  purchase products linked to your digital files.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <Box padding="400" paddingBlockEnd="0">
                <Filters
                  queryValue={searchQuery}
                  queryPlaceholder="Search by email, order, or file name"
                  onQueryChange={handleSearchChange}
                  onQueryClear={() => handleSearchChange("")}
                  filters={filters}
                  appliedFilters={appliedFilters}
                  onClearAll={() => {
                    handleStatusChange(["all"]);
                    handleSearchChange("");
                  }}
                />
              </Box>
              <IndexTable
                resourceName={{
                  singular: "magic link",
                  plural: "magic links",
                }}
                itemCount={links.length}
                headings={[
                  { title: "Customer" },
                  { title: "File" },
                  { title: "Order" },
                  { title: "Downloads" },
                  { title: "Status" },
                  { title: "Expires" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {links.map((link, index) => {
                  const isExpired = new Date() > new Date(link.expiresAt);
                  const isRevoked = !!link.revokedAt;
                  const isExhausted =
                    link.downloadCount >= link.maxDownloads;
                  const isActive = !isRevoked && !isExpired && !isExhausted;

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
                        <BlockStack>
                          <Text variant="bodyMd" fontWeight="bold">
                            {link.customerEmail}
                          </Text>
                          {link.customerName && (
                            <Text variant="bodySm" tone="subdued">
                              {link.customerName}
                            </Text>
                          )}
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {link.file.originalName}
                        </Text>
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
                      <IndexTable.Cell>{badge}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text variant="bodySm">
                          {new Date(link.expiresAt).toLocaleDateString()}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200">
                          {isActive && (
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => setRevokeId(link.id)}
                            >
                              Revoke
                            </Button>
                          )}
                          <Button
                            size="slim"
                            onClick={() => setRegenerateId(link.id)}
                          >
                            Regenerate
                          </Button>
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
              {totalPages > 1 && (
                <Box padding="400">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      hasNext={page < totalPages}
                      onPrevious={() => handlePagination("prev")}
                      onNext={() => handlePagination("next")}
                    />
                  </InlineStack>
                </Box>
              )}
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={!!revokeId}
        onClose={() => setRevokeId(null)}
        title="Revoke magic link?"
        primaryAction={{
          content: "Revoke",
          destructive: true,
          onAction: () => handleRevoke(revokeId),
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setRevokeId(null) },
        ]}
      >
        <Modal.Section>
          <Text>
            This will immediately disable the download link. The customer will
            no longer be able to download the file using this link. You can
            regenerate the link later if needed.
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!regenerateId}
        onClose={() => setRegenerateId(null)}
        title="Regenerate magic link?"
        primaryAction={{
          content: "Regenerate",
          onAction: () => handleRegenerate(regenerateId),
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setRegenerateId(null) },
        ]}
      >
        <Modal.Section>
          <Text>
            This will create a new download token, reset the download counter to
            0, and extend the expiry. The old link will stop working. You will
            need to send the new link to the customer manually.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
