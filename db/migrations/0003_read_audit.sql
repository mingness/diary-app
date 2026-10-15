CREATE TABLE "read_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"leader_id" uuid,
	"leader_username" text NOT NULL,
	"document_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "read_audit" ADD CONSTRAINT "read_audit_leader_id_users_id_fk" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_audit" ADD CONSTRAINT "read_audit_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "read_audit_document_idx" ON "read_audit" USING btree ("document_id","read_at");--> statement-breakpoint
CREATE INDEX "read_audit_read_at_idx" ON "read_audit" USING btree ("read_at");