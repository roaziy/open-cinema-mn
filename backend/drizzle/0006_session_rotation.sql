ALTER TABLE "sessions" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rotated_at" timestamp with time zone;