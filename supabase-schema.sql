-- ============================================
-- MagicDrop: Supabase Database Schema
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================

-- 1. Session table (Shopify auth sessions)
CREATE TABLE IF NOT EXISTS "Session" (
    "id"            TEXT PRIMARY KEY,
    "shop"          TEXT NOT NULL,
    "state"         TEXT NOT NULL,
    "isOnline"      BOOLEAN NOT NULL DEFAULT false,
    "scope"         TEXT,
    "expires"       TIMESTAMP(3),
    "accessToken"   TEXT NOT NULL,
    "userId"        BIGINT,
    "firstName"     TEXT,
    "lastName"      TEXT,
    "email"         TEXT,
    "accountOwner"  BOOLEAN NOT NULL DEFAULT false,
    "locale"        TEXT,
    "collaborator"  BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS "Session_shop_idx" ON "Session"("shop");

-- 2. ShopSettings table (merchant config per shop)
CREATE TABLE IF NOT EXISTS "ShopSettings" (
    "id"                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "shop"                TEXT NOT NULL UNIQUE,
    "defaultExpiryHours"  INTEGER NOT NULL DEFAULT 72,
    "defaultMaxDownloads" INTEGER NOT NULL DEFAULT 3,
    "emailSubject"        TEXT NOT NULL DEFAULT 'Your download is ready!',
    "emailBody"           TEXT NOT NULL DEFAULT 'Thank you for your purchase! Click the link below to download your files.',
    "brandColor"          TEXT NOT NULL DEFAULT '#5C6AC4',
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. DigitalFile table (uploaded files metadata)
CREATE TABLE IF NOT EXISTS "DigitalFile" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "shop"         TEXT NOT NULL,
    "fileName"     TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileSize"     INTEGER NOT NULL,
    "mimeType"     TEXT NOT NULL,
    "s3Key"        TEXT NOT NULL,
    "s3Bucket"     TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "DigitalFile_shop_idx" ON "DigitalFile"("shop");

-- 4. ProductFileLink table (file <-> Shopify product mapping)
CREATE TABLE IF NOT EXISTS "ProductFileLink" (
    "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "shop"             TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT,
    "productTitle"     TEXT NOT NULL,
    "variantTitle"     TEXT,
    "fileId"           TEXT NOT NULL REFERENCES "DigitalFile"("id") ON DELETE CASCADE,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("shopifyProductId", "shopifyVariantId", "fileId")
);
CREATE INDEX IF NOT EXISTS "ProductFileLink_shop_idx" ON "ProductFileLink"("shop");
CREATE INDEX IF NOT EXISTS "ProductFileLink_productId_idx" ON "ProductFileLink"("shopifyProductId");

-- 5. MagicLink table (download tokens for customers)
CREATE TABLE IF NOT EXISTS "MagicLink" (
    "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "shop"          TEXT NOT NULL,
    "token"         TEXT NOT NULL UNIQUE,
    "fileId"        TEXT NOT NULL REFERENCES "DigitalFile"("id") ON DELETE CASCADE,
    "orderId"       TEXT NOT NULL,
    "orderName"     TEXT,
    "customerEmail" TEXT NOT NULL,
    "customerName"  TEXT,
    "maxDownloads"  INTEGER NOT NULL DEFAULT 3,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "revokedAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MagicLink_shop_idx" ON "MagicLink"("shop");
CREATE INDEX IF NOT EXISTS "MagicLink_email_idx" ON "MagicLink"("customerEmail");
CREATE INDEX IF NOT EXISTS "MagicLink_orderId_idx" ON "MagicLink"("orderId");

-- 6. Download table (activity log)
CREATE TABLE IF NOT EXISTS "Download" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "magicLinkId"  TEXT NOT NULL REFERENCES "MagicLink"("id") ON DELETE CASCADE,
    "ipAddress"    TEXT,
    "userAgent"    TEXT,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Download_magicLinkId_idx" ON "Download"("magicLinkId");

-- 7. Prisma migrations tracking table
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36) PRIMARY KEY,
    "checksum"            VARCHAR(64) NOT NULL,
    "finished_at"         TIMESTAMP WITH TIME ZONE,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMP WITH TIME ZONE,
    "started_at"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);

-- Done! All 6 tables + indexes created.
-- Verify by running: SELECT tablename FROM pg_tables WHERE schemaname = 'public';
