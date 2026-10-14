CREATE TYPE "public"."access" AS ENUM('private', 'wait_for_open', 'open');--> statement-breakpoint
CREATE TYPE "public"."comment_state" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('create', 'submit', 'update');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" uuid,
	"body_ct" "bytea" NOT NULL,
	"body_nonce" "bytea" NOT NULL,
	"state" "comment_state" NOT NULL,
	"submitted_at" timestamp with time zone,
	"seen_by_owner_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"n" integer NOT NULL,
	CONSTRAINT "daily_usage_user_id_day_kind_pk" PRIMARY KEY("user_id","day","kind")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content_ct" "bytea" NOT NULL,
	"content_nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"draft_title" text,
	"diary_date" date NOT NULL,
	"content_ct" "bytea",
	"content_nonce" "bytea",
	"draft_ct" "bytea",
	"draft_nonce" "bytea",
	"draft_saved_at" timestamp with time zone,
	"first_submitted_at" timestamp with time zone,
	"last_submitted_at" timestamp with time zone,
	"access" "access" DEFAULT 'private' NOT NULL,
	"access_decided_by" uuid,
	"access_decided_at" timestamp with time zone,
	"dek_wrapped" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "documents_content_pair" CHECK (("documents"."content_ct" IS NULL) = ("documents"."content_nonce" IS NULL)),
	CONSTRAINT "documents_draft_pair" CHECK (("documents"."draft_ct" IS NULL) = ("documents"."draft_nonce" IS NULL)),
	CONSTRAINT "documents_submitted_has_content" CHECK (("documents"."first_submitted_at" IS NULL) = ("documents"."content_ct" IS NULL)),
	CONSTRAINT "documents_only_submitted_shared" CHECK ("documents"."access" = 'private' OR "documents"."first_submitted_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_usage" ADD CONSTRAINT "daily_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_access_decided_by_users_id_fk" FOREIGN KEY ("access_decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_doc_author_key" ON "comments" USING btree ("document_id","author_id");--> statement-breakpoint
CREATE INDEX "comments_document_idx" ON "comments" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_no_key" ON "document_versions" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "documents_owner_date_idx" ON "documents" USING btree ("owner_id","diary_date");--> statement-breakpoint
CREATE INDEX "documents_submitted_date_idx" ON "documents" USING btree ("diary_date") WHERE "documents"."first_submitted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_access_idx" ON "documents" USING btree ("access");--> statement-breakpoint
CREATE INDEX "documents_key_version_idx" ON "documents" USING btree ("key_version");