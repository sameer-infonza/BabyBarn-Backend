-- Admin in-app notifications with per-user read receipts
CREATE TYPE "AdminNotificationType" AS ENUM (
  'NEW_ORDER',
  'RETURN_REQUEST',
  'LOW_STOCK',
  'CANCELLATION_REVIEW',
  'INSPECTION_QUEUED',
  'ACCESS_EXPIRING'
);

CREATE TABLE "AdminNotification" (
  "id" SERIAL NOT NULL,
  "publicId" TEXT NOT NULL,
  "type" "AdminNotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminNotificationRead" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "notificationId" INTEGER NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminNotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminNotification_publicId_key" ON "AdminNotification"("publicId");
CREATE INDEX "AdminNotification_type_entityId_idx" ON "AdminNotification"("type", "entityId");
CREATE INDEX "AdminNotification_module_idx" ON "AdminNotification"("module");
CREATE INDEX "AdminNotification_createdAt_idx" ON "AdminNotification"("createdAt");

CREATE UNIQUE INDEX "AdminNotificationRead_userId_notificationId_key" ON "AdminNotificationRead"("userId", "notificationId");
CREATE INDEX "AdminNotificationRead_userId_idx" ON "AdminNotificationRead"("userId");
CREATE INDEX "AdminNotificationRead_notificationId_idx" ON "AdminNotificationRead"("notificationId");

ALTER TABLE "AdminNotificationRead" ADD CONSTRAINT "AdminNotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminNotificationRead" ADD CONSTRAINT "AdminNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "AdminNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
