CREATE TYPE "public"."loyalty_kind" AS ENUM('earn', 'reverse');--> statement-breakpoint
CREATE TABLE "loyalty_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"booking_id" uuid,
	"points" integer NOT NULL,
	"kind" "loyalty_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "member_no" integer NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "users_member_no_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 100001 CACHE 1);--> statement-breakpoint
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_entries_booking_kind_unique" ON "loyalty_entries" USING btree ("booking_id","kind") WHERE "loyalty_entries"."booking_id" is not null;--> statement-breakpoint
CREATE INDEX "loyalty_entries_user_idx" ON "loyalty_entries" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_member_no_unique" ON "users" USING btree ("member_no");