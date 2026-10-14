CREATE TYPE "public"."activity_kind" AS ENUM('entry_created', 'entry_submitted', 'entry_updated', 'count_entry', 'limit_reached', 'login', 'login_failed', 'new_device', 'password_changed');--> statement-breakpoint
CREATE TYPE "public"."alert_rule" AS ENUM('limit_reached', 'login_failures', 'new_devices');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"rule" "alert_rule" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "job_status" NOT NULL,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user_time_idx" ON "activity_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_kind_time_idx" ON "activity_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_user_rule_key" ON "alerts" USING btree ("user_id","rule") WHERE "alerts"."handled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "alerts_created_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_runs_job_time_idx" ON "job_runs" USING btree ("job","started_at");