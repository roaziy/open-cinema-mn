CREATE SEQUENCE "public"."booking_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10000 CACHE 1;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "order_no" text DEFAULT 'OC-' || nextval('booking_order_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "seat_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_order_no_unique" ON "bookings" USING btree ("order_no");