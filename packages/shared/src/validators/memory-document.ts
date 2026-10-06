import { z } from "zod";

export const memoryDocumentSlugSchema = z.string().trim().min(1).max(200).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "Memory document slug must contain only lowercase letters, numbers, and single hyphens",
);

export const memoryDocumentSchema = z.object({
  id: z.string().guid(),
  companyId: z.string().guid(),
  folderId: z.string().guid().nullable(),
  title: z.string().min(1),
  slug: memoryDocumentSlugSchema,
  markdown: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const memoryDocumentListItemSchema = memoryDocumentSchema.omit({ markdown: true });

export const memoryDocumentListResultSchema = z.object({
  documents: z.array(memoryDocumentListItemSchema),
  allCount: z.number().int().nonnegative(),
  unfiledCount: z.number().int().nonnegative(),
});

export const createMemoryDocumentSchema = z.object({
  folderId: z.string().guid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  slug: memoryDocumentSlugSchema.optional().nullable(),
  markdown: z.string().optional(),
});

export const updateMemoryDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  markdown: z.string().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one memory document field is required",
});

export const moveMemoryDocumentSchema = z.object({
  folderId: z.string().guid().optional().nullable(),
});

export type CreateMemoryDocument = z.infer<typeof createMemoryDocumentSchema>;
export type UpdateMemoryDocument = z.infer<typeof updateMemoryDocumentSchema>;
export type MoveMemoryDocument = z.infer<typeof moveMemoryDocumentSchema>;
