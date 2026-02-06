import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.S3_BUCKET_NAME || "magicdrop-files";

/**
 * Upload a file to S3 under the shop's namespace.
 * Returns the S3 key and bucket name.
 */
export async function uploadFileToS3(shop, fileName, fileBuffer, mimeType) {
  const sanitizedShop = shop.replace(/[^a-zA-Z0-9.-]/g, "_");
  const key = `${sanitizedShop}/${uuidv4()}/${fileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      ServerSideEncryption: "AES256",
    })
  );

  return { s3Key: key, s3Bucket: BUCKET };
}

/**
 * Generate a time-limited presigned URL for downloading a file from S3.
 */
export async function getPresignedDownloadUrl(s3Key, s3Bucket, expiresIn = 300) {
  const command = new GetObjectCommand({
    Bucket: s3Bucket || BUCKET,
    Key: s3Key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete a file from S3.
 */
export async function deleteFileFromS3(s3Key, s3Bucket) {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: s3Bucket || BUCKET,
      Key: s3Key,
    })
  );
}

/**
 * Check if a file exists in S3.
 */
export async function fileExistsInS3(s3Key, s3Bucket) {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: s3Bucket || BUCKET,
        Key: s3Key,
      })
    );
    return true;
  } catch {
    return false;
  }
}
