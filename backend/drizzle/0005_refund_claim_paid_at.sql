ALTER TYPE "public"."payment_status" ADD VALUE 'refunding' BEFORE 'failed';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_claimed_at" timestamp with time zone;
UPDATE "bookings" SET "paid_at" = "created_at" WHERE "status" = 'paid';
