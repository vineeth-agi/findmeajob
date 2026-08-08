-- Better Auth 1.6 Google OAuth core schema for Cloudflare D1.
-- Auth tables are prefixed to avoid collisions with the existing job catalog.

CREATE TABLE IF NOT EXISTS "auth_user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" INTEGER NOT NULL DEFAULT 0,
  "image" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_user_email_uidx"
  ON "auth_user" ("email");

CREATE TABLE IF NOT EXISTS "auth_session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "auth_user" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_session_token_uidx"
  ON "auth_session" ("token");
CREATE INDEX IF NOT EXISTS "auth_session_user_id_idx"
  ON "auth_session" ("userId");
CREATE INDEX IF NOT EXISTS "auth_session_expires_at_idx"
  ON "auth_session" ("expiresAt");

CREATE TABLE IF NOT EXISTS "auth_account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" INTEGER,
  "refreshTokenExpiresAt" INTEGER,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "auth_user" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_account_provider_account_uidx"
  ON "auth_account" ("providerId", "accountId");
CREATE INDEX IF NOT EXISTS "auth_account_user_id_idx"
  ON "auth_account" ("userId");

CREATE TABLE IF NOT EXISTS "auth_verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_verification_identifier_idx"
  ON "auth_verification" ("identifier");
CREATE INDEX IF NOT EXISTS "auth_verification_expires_at_idx"
  ON "auth_verification" ("expiresAt");

CREATE TABLE IF NOT EXISTS "auth_rate_limit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_rate_limit_key_uidx"
  ON "auth_rate_limit" ("key");
