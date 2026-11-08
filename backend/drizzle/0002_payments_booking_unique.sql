DROP INDEX "payments_booking_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "payments_booking_unique" ON "payments" USING btree ("booking_id");