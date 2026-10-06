import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createMemoryDocumentSchema,
  moveMemoryDocumentSchema,
  updateMemoryDocumentSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { badRequest } from "../errors.js";
import { logActivity, memoryDocumentService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function memoryDocumentRoutes(db: Db) {
  const router = Router();
  const svc = memoryDocumentService(db);

  router.get("/companies/:companyId/memory-documents", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.list(companyId));
  });

  router.get("/companies/:companyId/memory-documents/resolve", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const target = req.query.target;
    if (typeof target !== "string" || target.trim().length === 0) {
      throw badRequest("A target query parameter is required");
    }
    res.json({ document: await svc.resolveByTitle(companyId, target) });
  });

  router.get("/companies/:companyId/memory-documents/:documentId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.get(companyId, req.params.documentId as string));
  });

  router.post(
    "/companies/:companyId/memory-documents",
    validate(createMemoryDocumentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const created = await svc.create(companyId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "memory_document.created",
        entityType: "memory_document",
        entityId: created.id,
        details: { title: created.title, slug: created.slug, folderId: created.folderId },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/memory-documents/:documentId",
    validate(updateMemoryDocumentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);
      const updated = await svc.update(companyId, documentId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "memory_document.updated",
        entityType: "memory_document",
        entityId: updated.id,
        details: { title: updated.title, folderId: updated.folderId },
      });
      res.json(updated);
    },
  );

  router.post(
    "/companies/:companyId/memory-documents/:documentId/move",
    validate(moveMemoryDocumentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);
      const moved = await svc.move(companyId, documentId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "memory_document.moved",
        entityType: "memory_document",
        entityId: moved.id,
        details: { title: moved.title, folderId: moved.folderId },
      });
      res.json(moved);
    },
  );

  router.delete("/companies/:companyId/memory-documents/:documentId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const documentId = req.params.documentId as string;
    assertCompanyAccess(req, companyId);
    const deleted = await svc.delete(companyId, documentId);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "memory_document.deleted",
      entityType: "memory_document",
      entityId: deleted.id,
      details: { title: deleted.title, folderId: deleted.folderId },
    });
    res.json({ deleted });
  });

  return router;
}
