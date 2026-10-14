CREATE TYPE "public"."mfa_state" AS ENUM('not_required', 'pending', 'enrolment_required', 'verified');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('browser', 'device');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark', 'system');--> statement-breakpoint
CREATE TABLE "captchas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"answer_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" "bytea" PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "session_kind" NOT NULL,
	"device_label" text NOT NULL,
	"csrf_token" text NOT NULL,
	"mfa" "mfa_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	"reset_pending" boolean DEFAULT false NOT NULL,
	"totp_secret_ct" "bytea",
	"totp_secret_nonce" "bytea",
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" integer,
	"font_size" smallint DEFAULT 18 NOT NULL,
	"theme" "theme" DEFAULT 'system' NOT NULL,
	"profile_ct" "bytea" NOT NULL,
	"profile_nonce" "bytea" NOT NULL,
	"profile_dek_wrapped" "bytea" NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_font_size_check" CHECK ("users"."font_size" IN (16, 18, 20, 22)),
	CONSTRAINT "users_totp_pair_check" CHECK (("users"."totp_secret_ct" IS NULL) = ("users"."totp_secret_nonce" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captchas_expires_idx" ON "captchas" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email")) WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");