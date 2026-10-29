import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Reads the token usage / cost Hermes recorded for a finished session.
 *
 * Why not scrape stdout: the adapter used to parse a `tokens: N input ... M output`
 * regex out of the CLI output, but Hermes in quiet mode (`-Q`) only prints the
 * response and `session_id:`. The result was that `usage` was always empty, the
 * server never wrote a `cost_events` row and every cost indicator stayed at zero.
 *
 * Why not `--usage-file`: that flag exists only on the top-level CLI parser
 * (`hermes --usage-file out.json -z "..."`), it is NOT accepted after the `chat`
 * subcommand the adapter has to use, and it writes nothing for `chat -Q`.
 *
 * So the source of truth is Hermes' own session store (`<HERMES_HOME>/state.db`,
 * table `sessions`), which records `input_tokens`, `output_tokens`,
 * `cache_read_tokens`, `estimated_cost_usd`/`actual_cost_usd`, `cost_status`,
 * `model` and `billing_provider` per session. Read is read-only and best-effort:
 * any failure (locked DB, missing Node sqlite, older Hermes) returns `null` and the
 * run simply proceeds without usage, exactly like before this change.
 */

export interface HermesSessionUsage {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
  costStatus: string | null;
  costSource: string | null;
  model: string | null;
  provider: string | null;
  apiCalls: number;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolves `<HERMES_HOME>/state.db` following Hermes' own precedence:
 * explicit env override → HERMES_HOME → platform default
 * (%LOCALAPPDATA%\hermes on Windows, ~/.hermes elsewhere).
 */
export function resolveHermesStateDbPath(config?: Record<string, unknown>): string | null {
  const configEnv =
    typeof config?.env === "object" && config?.env !== null && !Array.isArray(config.env)
      ? (config.env as Record<string, unknown>)
      : {};

  const explicit = asString(configEnv.HERMES_STATE_DB) ?? asString(process.env.HERMES_STATE_DB);
  if (explicit) return explicit;

  const home = asString(configEnv.HERMES_HOME) ?? asString(process.env.HERMES_HOME);
  if (home) return path.join(home, "state.db");

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) return path.join(localAppData, "hermes", "state.db");
    return path.join(os.homedir(), "AppData", "Local", "hermes", "state.db");
  }
  return path.join(os.homedir(), ".hermes", "state.db");
}

interface SessionRow {
  id?: string;
  input_tokens?: number | bigint;
  output_tokens?: number | bigint;
  cache_read_tokens?: number | bigint;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  cost_status?: string | null;
  cost_source?: string | null;
  model?: string | null;
  billing_provider?: string | null;
  api_call_count?: number | bigint;
}

type SqliteDatabase = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => SessionRow | undefined;
  };
  close: () => void;
};

async function openReadOnly(dbPath: string): Promise<SqliteDatabase | null> {
  try {
    // `node:sqlite` ships with Node >= 22.5 and needs no extra dependency. Imported
    // dynamically so an older runtime degrades to "no usage" instead of crashing.
    const mod = (await import("node:sqlite" as string)) as {
      DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
    };
    return new mod.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

const SESSION_USAGE_SQL =
  "select id, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, " +
  "actual_cost_usd, cost_status, cost_source, model, billing_provider, api_call_count " +
  "from sessions where id = ? limit 1";

/**
 * @param retries Hermes may still be flushing the session row right after the child
 *   exits; a couple of short retries make the read reliable without slowing runs.
 */
export async function readHermesSessionUsage(
  config: Record<string, unknown> | undefined,
  sessionId: string | null | undefined,
  options: { retries?: number; delayMs?: number } = {},
): Promise<HermesSessionUsage | null> {
  const id = asString(sessionId);
  if (!id) return null;

  const dbPath = resolveHermesStateDbPath(config);
  if (!dbPath || !fs.existsSync(dbPath)) return null;

  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 250;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const db = await openReadOnly(dbPath);
    if (!db) return null;
    try {
      const row = db.prepare(SESSION_USAGE_SQL).get(id);
      if (row) {
        const actual = typeof row.actual_cost_usd === "number" ? row.actual_cost_usd : null;
        const estimated =
          typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : null;
        return {
          sessionId: asString(row.id) ?? id,
          inputTokens: asNumber(row.input_tokens),
          outputTokens: asNumber(row.output_tokens),
          cachedInputTokens: asNumber(row.cache_read_tokens),
          costUsd: actual ?? estimated,
          costStatus: asString(row.cost_status),
          costSource: asString(row.cost_source),
          model: asString(row.model),
          provider: asString(row.billing_provider),
          apiCalls: asNumber(row.api_call_count),
        };
      }
    } catch {
      // Locked/corrupt/unexpected schema: fall through and retry, then give up.
    } finally {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
