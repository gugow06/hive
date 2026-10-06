import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { folders } from "./folders.js";

export const memoryDocuments = pgTable(
  "memory_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    // Deleting a folder keeps its documents; they fall back to the unfiled root.
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    markdown: text("markdown").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Company-wide slug uniqueness is what lets `[[wikilinks]]` resolve by name alone.
    companySlugUniqueIdx: uniqueIndex("memory_documents_company_slug_uq").on(
      table.companyId,
      table.slug,
    ),
    companyFolderIdx: index("memory_documents_company_folder_idx").on(
      table.companyId,
      table.folderId,
    ),
    companyTitleIdx: index("memory_documents_company_title_idx").on(table.companyId, table.title),
  }),
);
