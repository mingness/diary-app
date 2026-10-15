CREATE TABLE "count_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"daily_count" integer NOT NULL,
	"count_date" date NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"auto" boolean NOT NULL,
	CONSTRAINT "count_entries_daily_count_range" CHECK ("count_entries"."daily_count" BETWEEN 1 AND 1080)
);
--> statement-breakpoint
CREATE TABLE "count_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"auto_submit" boolean DEFAULT false NOT NULL,
	"saved_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "count_settings_saved_count_range" CHECK ("count_settings"."saved_count" BETWEEN 0 AND 1080)
);
--> statement-breakpoint
ALTER TABLE "count_entries" ADD CONSTRAINT "count_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_settings" ADD CONSTRAINT "count_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "count_entries_user_date_idx" ON "count_entries" USING btree ("user_id","count_date");--> statement-breakpoint
CREATE INDEX "count_entries_date_idx" ON "count_entries" USING btree ("count_date");--> statement-breakpoint
CREATE UNIQUE INDEX "count_entries_one_auto_key" ON "count_entries" USING btree ("user_id","count_date") WHERE "count_entries"."auto";