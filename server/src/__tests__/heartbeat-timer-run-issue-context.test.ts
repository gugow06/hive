import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

// PHO-74: a timer wake without an issue id in its context snapshot cannot write
// anywhere (403 cross_issue_influence_run_context_required) and the adapter never
// receives PAPERCLIP_TASK_ID. The scheduler must carry the agent's in-progress
// card into the wake so the run has an owner for its own writes.

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Timer run issue-context test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres timer run issue-context tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function ensureIssueRelationsTable(db: ReturnType<typeof createDb>) {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "issue_relations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "company_id" uuid NOT NULL,
      "issue_id" uuid NOT NULL,
      "related_issue_id" uuid NOT NULL,
      "type" text NOT NULL,
      "created_by_agent_id" uuid,
      "created_by_user_id" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `));
}

async function waitForCondition(fn: () => Promise<boolean>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fn();
}

describeEmbeddedPostgres("heartbeat timer wake carries issue context", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-timer-issue-context-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db, {
      runtimeEnv: { ...process.env, PAPERCLIP_IN_WORKTREE: "false" },
    });
    await ensureIssueRelationsTable(db);
  }, 180_000);

  afterEach(async () => {
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runs = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns);
      if (!runs.some((run) => run.status === "queued" || run.status === "running")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // A run can still be finishing its own writes for a few milliseconds after it
    // leaves running; retry the truncate instead of racing it into a deadlock.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await db.execute(sql.raw(`
          TRUNCATE TABLE
            "issue_relations",
            "issues",
            "heartbeat_run_events",
            "activity_log",
            "heartbeat_runs",
            "agent_wakeup_requests",
            "agent_runtime_state",
            "agents",
            "companies"
          RESTART IDENTITY CASCADE
        `));
        break;
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } }).code
          ?? (error as { cause?: { code?: string } }).cause?.code;
        if ((code !== "40P01" && code !== "23503") || attempt === 19) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user",
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Hugbee",
      role: "general",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
        },
      },
      permissions: {},
    });
    return { companyId, agentId };
  }

  async function seedIssue(input: {
    companyId: string;
    agentId: string;
    status: "todo" | "in_progress";
    updatedAt: Date;
  }) {
    const issueId = randomUUID();
    await db.insert(issues).values({
      id: issueId,
      companyId: input.companyId,
      title: `Card ${input.status}`,
      status: input.status,
      assigneeAgentId: input.agentId,
      updatedAt: input.updatedAt,
    });
    return issueId;
  }

  async function tickDueTimer(agentId: string, now: Date) {
    await db
      .update(agents)
      .set({ lastHeartbeatAt: new Date(now.getTime() - 120_000) })
      .where(sql`${agents.id} = ${agentId}`);
    const result = await heartbeat.tickTimers(now);
    await waitForCondition(async () => {
      const runs = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(sql`${heartbeatRuns.agentId} = ${agentId}`);
      return runs.length > 0;
    });
    const run = await db
      .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
      .from(heartbeatRuns)
      .where(sql`${heartbeatRuns.agentId} = ${agentId}`)
      .then((rows) => rows[0] ?? null);
    return { result, snapshot: (run?.contextSnapshot ?? null) as Record<string, unknown> | null };
  }

  it("puts the agent's in-progress card in the timer wake context snapshot", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const now = new Date();
    const issueId = await seedIssue({
      companyId,
      agentId,
      status: "in_progress",
      updatedAt: new Date(now.getTime() - 60_000),
    });

    const { result, snapshot } = await tickDueTimer(agentId, now);

    expect(result.enqueued).toBe(1);
    expect(snapshot).toMatchObject({
      reason: "interval_elapsed",
      issueId,
      taskId: issueId,
    });
  });

  it("leaves the timer wake unscoped when the agent has no in-progress card", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const now = new Date();
    await seedIssue({
      companyId,
      agentId,
      status: "todo",
      updatedAt: new Date(now.getTime() - 60_000),
    });

    const { result, snapshot } = await tickDueTimer(agentId, now);

    expect(result.enqueued).toBe(1);
    expect(snapshot).toMatchObject({ reason: "interval_elapsed" });
    expect(snapshot?.issueId).toBeUndefined();
    expect(snapshot?.taskId).toBeUndefined();
  });

  it("picks the most recently updated in-progress card", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const now = new Date();
    await seedIssue({
      companyId,
      agentId,
      status: "in_progress",
      updatedAt: new Date(now.getTime() - 300_000),
    });
    const newestIssueId = await seedIssue({
      companyId,
      agentId,
      status: "in_progress",
      updatedAt: new Date(now.getTime() - 30_000),
    });

    const { snapshot } = await tickDueTimer(agentId, now);

    expect(snapshot?.issueId).toBe(newestIssueId);
  });
});
