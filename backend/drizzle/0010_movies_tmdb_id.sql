ALTER TABLE "movies" ADD COLUMN "tmdb_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "movies_tmdb_id_unique" ON "movies" USING btree ("tmdb_id") WHERE "movies"."tmdb_id" is not null;