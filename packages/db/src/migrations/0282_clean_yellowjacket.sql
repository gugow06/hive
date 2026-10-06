CREATE TABLE "memory_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_documents" ADD CONSTRAINT "memory_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_documents" ADD CONSTRAINT "memory_documents_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memory_documents_company_slug_uq" ON "memory_documents" USING btree ("company_id","slug");--> statement-breakpoint
CREATE INDEX "memory_documents_company_folder_idx" ON "memory_documents" USING btree ("company_id","folder_id");--> statement-breakpoint
CREATE INDEX "memory_documents_company_title_idx" ON "memory_documents" USING btree ("company_id","title");