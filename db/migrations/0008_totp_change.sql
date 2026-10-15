ALTER TYPE "public"."activity_kind" ADD VALUE 'totp_changed';--> statement-breakpoint
ALTER TYPE "public"."alert_rule" ADD VALUE 'totp_changed';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_ct" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_nonce" "bytea";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_totp_pending_pair_check" CHECK (("users"."totp_pending_ct" IS NULL) = ("users"."totp_pending_nonce" IS NULL));