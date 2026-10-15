ALTER TYPE "public"."activity_kind" ADD VALUE 'elevated_activity' BEFORE 'login';--> statement-breakpoint
ALTER TYPE "public"."alert_rule" ADD VALUE 'elevated_activity' BEFORE 'login_failures';--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'comment';