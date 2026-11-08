ALTER TABLE "ticket_scans" ADD COLUMN "response" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_scans" ALTER COLUMN "response" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "ticket_scans_previous_idx" ON "ticket_scans" USING btree ("previous_scan_id");--> statement-breakpoint
CREATE INDEX "ticket_scans_staff_device_idx" ON "ticket_scans" USING btree ("staff_id","device_id","created_at" DESC NULLS LAST);