-- Splits back-office accounts (staff, admin) out of "users" into "staff_accounts", keeping ids.
-- drizzle runs the pending migrations in one transaction, so a failure leaves nothing half-moved.
CREATE TYPE "public"."staff_role" AS ENUM('staff', 'admin');--> statement-breakpoint
CREATE TABLE "staff_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "staff_role" DEFAULT 'staff' NOT NULL,
	"phone" text,
	"email" text,
	"password_hash" text,
	"name" text,
	"branch_id" uuid,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_accounts" ADD CONSTRAINT "staff_accounts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_accounts_phone_unique" ON "staff_accounts" USING btree ("phone") WHERE "staff_accounts"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_accounts_email_unique" ON "staff_accounts" USING btree ("email") WHERE "staff_accounts"."email" is not null;--> statement-breakpoint
-- Every staff and admin row moves over with the same id.
INSERT INTO "staff_accounts" ("id", "role", "phone", "email", "password_hash", "name", "branch_id", "failed_logins", "locked_until", "created_at")
SELECT "id", "role"::text::"staff_role", "phone", "email", "password_hash", "name", "branch_id", "failed_logins", "locked_until", "created_at"
FROM "users" WHERE "role" IN ('staff', 'admin');--> statement-breakpoint
-- Former staff who were later demoted to customer still own scan history: give each a
-- phoneless staff account (the shape of a removed staff member) so the history keeps its owner.
INSERT INTO "staff_accounts" ("id", "role", "name", "created_at")
SELECT "id", 'staff', "name", "created_at" FROM "users" u
WHERE u."role" NOT IN ('staff', 'admin')
  AND (EXISTS (SELECT 1 FROM "ticket_scans" s WHERE s."staff_id" = u."id")
    OR EXISTS (SELECT 1 FROM "tickets" t WHERE t."used_by" = u."id"));--> statement-breakpoint
-- Sessions: one table, one owner column per kind.
ALTER TABLE "sessions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "staff_account_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_account_id_staff_accounts_id_fk" FOREIGN KEY ("staff_account_id") REFERENCES "public"."staff_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_staff_account_idx" ON "sessions" USING btree ("staff_account_id");--> statement-breakpoint
UPDATE "sessions" SET "staff_account_id" = "user_id", "user_id" = NULL
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" IN ('staff', 'admin'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_check" CHECK (num_nonnulls("sessions"."user_id", "sessions"."staff_account_id") = 1);--> statement-breakpoint
-- Scan history points at the back-office account (ids are unchanged).
ALTER TABLE "ticket_scans" DROP CONSTRAINT "ticket_scans_staff_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_used_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_staff_id_staff_accounts_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_used_by_staff_accounts_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."staff_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- A staff or admin row that also made bookings stays behind as a customer so those bookings
-- keep their owner; every other one leaves "users" (its holds go with it).
UPDATE "users" SET "role" = 'customer'
WHERE "role" IN ('staff', 'admin')
  AND EXISTS (SELECT 1 FROM "bookings" b WHERE b."user_id" = "users"."id");--> statement-breakpoint
DELETE FROM "users" WHERE "role" IN ('staff', 'admin');--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_branch_id_branches_id_fk";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "branch_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "failed_logins";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "locked_until";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('guest', 'customer'));
