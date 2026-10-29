import { describe, expect, it } from "vitest";

import { countToolCalls, parseHermesOutput } from "./execute.js";

/**
 * PHO-85: a turn cut short by Hermes' own gateway disconnect still printed the
 * `hermes --resume <id>` footer. The adapter used to scrape the disconnect advice
 * ("Resume the printed session ID to check whether it completed") as the session
 * id, which yielded the literal id `to`. The bogus id then failed the canonical
 * check downstream, so no session was ever resumed and every retry redid the work.
 *
 * The footer is the only session evidence left on a dead turn, so these tests pin
 * the whole-line anchors and the precedence order.
 */

const LOCAL_SESSION_ID =
  "local-b233e8477a8c35f91d5e0c775b189803a3d7b0124f7b258d9402f40f647e8c4d";

describe("parseHermesOutput session id sources", () => {
  it("reads the resume footer printed on an interrupted turn", () => {
    const stdout = [
      "Working on PHO-85...",
      "",
      "Gateway disconnected; turn outcome is unknown.",
      "Resume this session with:",
      `  hermes --resume ${LOCAL_SESSION_ID}`,
    ].join("\n");

    const parsed = parseHermesOutput(stdout, "");

    expect(parsed.sessionId).toBe(LOCAL_SESSION_ID);
  });

  it("does not scrape the disconnect advice as a session id", () => {
    const stdout = [
      "Gateway disconnected; turn outcome is unknown.",
      "Resume the printed session ID to check whether it completed.",
    ].join("\n");

    const parsed = parseHermesOutput(stdout, "");

    expect(parsed.sessionId).toBeUndefined();
  });

  it("falls back to the summary block when no resume footer is printed", () => {
    const stdout = ["All done.", "", "Session:        20261026_114032_776f76", "Duration:       58s"].join(
      "\n",
    );

    const parsed = parseHermesOutput(stdout, "");

    expect(parsed.sessionId).toBe("20261026_114032_776f76");
  });

  it("keeps the documented quiet-mode contract", () => {
    const stdout = ["Resposta curta.", "", "session_id: " + LOCAL_SESSION_ID].join("\n");

    const parsed = parseHermesOutput(stdout, "");

    expect(parsed.sessionId).toBe(LOCAL_SESSION_ID);
    expect(parsed.response).toBe("Resposta curta.");
  });
});

describe("countToolCalls", () => {
  it("counts rendered tool invocations", () => {
    const stdout = [
      "┊ 🔧 Patch src/app/api/vagas/route.ts  25.3s",
      "┊ 🔧 Read src/app/page.tsx  1.2s",
      "done",
    ].join("\n");

    expect(countToolCalls(stdout)).toBe(2);
  });

  it("ignores ANSI colour codes around the marker", () => {
    const stdout = "\u001b[36m🔧\u001b[0m Bash pnpm test  12.0s";

    expect(countToolCalls(stdout)).toBe(1);
  });

  it("returns zero for a stream with no tool invocations", () => {
    expect(countToolCalls("nada aqui")).toBe(0);
  });
});
