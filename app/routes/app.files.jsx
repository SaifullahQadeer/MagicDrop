import { json } from "@remix-run/node";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  EmptyState,
  BlockStack,
  InlineStack,
  DropZone,
  Banner,
  Thumbnail,
  Modal,
  Box,
} from "@shopify/polaris";
import { NoteIcon, DeleteIcon } from "@shopify/polaris-icons";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { uploadFileToS3, deleteFileFromS3 } from "../services/s3.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const files = await db.digitalFile.findMany({
    where: { shop },
    include: {
      productLinks: true,
      _count: { select: { magicLinks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return json({ files });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "upload") {
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { s3Key, s3Bucket } = await uploadFileToS3(
      shop,
      file.name,
      buffer,
      file.type
    );

    await db.digitalFile.create({
      data: {
        shop,
        fileName: file.name,
        originalName: file.name,
        fileSize: buffer.length,
        mimeType: file.type || "application/octet-stream",
        s3Key,
        s3Bucket,
      },
    });

    return json({ success: true, message: "File uploaded successfully" });
  }

  if (intent === "delete") {
    const fileId = formData.get("fileId");
    const file = await db.digitalFile.findFirst({
      where: { id: fileId, shop },
    });

    if (file) {
      await deleteFileFromS3(file.s3Key, file.s3Bucket);
      await db.digitalFile.delete({ where: { id: fileId } });
    }

    return json({ success: true, message: "File deleted" });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function FilesPage() {
  const { files } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [deleteFileId, setDeleteFileId] = useState(null);

  const isUploading =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "upload";

  const handleDrop = useCallback((_dropFiles, acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
    }
  }, []);

  const handleUpload = useCallback(() => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("intent", "upload");
    formData.append("file", selectedFile);
    submit(formData, { method: "post", encType: "multipart/form-data" });
    setSelectedFile(null);
    setUploadModalOpen(false);
  }, [selectedFile, submit]);

  const handleDelete = useCallback(
    (fileId) => {
      const formData = new FormData();
      formData.append("intent", "delete");
      formData.append("fileId", fileId);
      submit(formData, { method: "post" });
      setDeleteFileId(null);
    },
    [submit]
  );

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const resourceName = { singular: "file", plural: "files" };

  const rowMarkup = files.map((file, index) => (
    <IndexTable.Row id={file.id} key={file.id} position={index}>
      <IndexTable.Cell>
        <InlineStack gap="300" blockAlign="center">
          <Thumbnail source={NoteIcon} alt={file.originalName} size="small" />
          <BlockStack>
            <Text variant="bodyMd" fontWeight="bold">
              {file.originalName}
            </Text>
            <Text variant="bodySm" tone="subdued">
              {formatFileSize(file.fileSize)} &middot; {file.mimeType}
            </Text>
          </BlockStack>
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {file.productLinks.length > 0 ? (
          <Badge tone="success">{file.productLinks.length} products</Badge>
        ) : (
          <Badge tone="attention">No products linked</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodySm">{file._count.magicLinks} links</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text variant="bodySm">
          {new Date(file.createdAt).toLocaleDateString()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button onClick={() => navigate(`/app/files/${file.id}`)} size="slim">
            Manage
          </Button>
          <Button
            icon={DeleteIcon}
            tone="critical"
            variant="plain"
            onClick={() => setDeleteFileId(file.id)}
          />
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Digital Files"
      primaryAction={{
        content: "Upload file",
        onAction: () => setUploadModalOpen(true),
      }}
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
          {files.length === 0 ? (
            <Card>
              <EmptyState
                heading="Upload your first digital file"
                action={{
                  content: "Upload file",
                  onAction: () => setUploadModalOpen(true),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Upload eBooks, courses, templates, and other digital products.
                  Then link them to your Shopify products so customers receive
                  automatic download links after purchase.
                </p>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <IndexTable
                resourceName={resourceName}
                itemCount={files.length}
                headings={[
                  { title: "File" },
                  { title: "Products" },
                  { title: "Links" },
                  { title: "Uploaded" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={uploadModalOpen}
        onClose={() => {
          setUploadModalOpen(false);
          setSelectedFile(null);
        }}
        title="Upload digital file"
        primaryAction={{
          content: isUploading ? "Uploading..." : "Upload",
          onAction: handleUpload,
          disabled: !selectedFile || isUploading,
          loading: isUploading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setUploadModalOpen(false);
              setSelectedFile(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <DropZone onDrop={handleDrop} allowMultiple={false}>
              {selectedFile ? (
                <Box padding="400">
                  <InlineStack gap="300" blockAlign="center">
                    <Thumbnail
                      source={NoteIcon}
                      alt={selectedFile.name}
                      size="small"
                    />
                    <BlockStack>
                      <Text variant="bodyMd" fontWeight="bold">
                        {selectedFile.name}
                      </Text>
                      <Text variant="bodySm" tone="subdued">
                        {formatFileSize(selectedFile.size)}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              ) : (
                <DropZone.FileUpload />
              )}
            </DropZone>
            <Text variant="bodySm" tone="subdued">
              Supported: PDF, ZIP, EPUB, MP3, MP4, and other common formats. Max
              500MB per file.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={!!deleteFileId}
        onClose={() => setDeleteFileId(null)}
        title="Delete file?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: () => handleDelete(deleteFileId),
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteFileId(null) },
        ]}
      >
        <Modal.Section>
          <Text>
            This will permanently delete the file from storage and remove all
            product links. Existing magic links for this file will stop working.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
