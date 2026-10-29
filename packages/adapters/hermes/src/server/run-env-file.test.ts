/**
 * The tool shell does not inherit the agent process environment, so the adapter
 * hands the PAPERCLIP_* identity vars to the run through a per-run shell file.
 * These tests pin the file format, the quoting and the prompt note that tells
 * the agent to source it.
 */

import { describe, expect, it } from "vitest";

import { renderRunEnvShell, runEnvFilePath, runEnvPromptNote } from "./execute.js";

describe("renderRunEnvShell", () => {
  it("exports the identity vars and skips everything else", () => {
    const shell = renderRunEnvShell({
      PAPERCLIP_API_URL: "http://127.0.0.1:3100",
      PAPERCLIP_API_KEY: "run-token",
      PAPERCLIP_RUN_ID: "run-1",
      PAPERCLIP_TASK_ID: "task-1",
      PAPERCLIP_AGENT_JWT_SECRET: "should-not-leak",
      PATH: "/usr/bin",
    });

    expect(shell).toContain("export PAPERCLIP_API_URL='http://127.0.0.1:3100'");
    expect(shell).toContain("export PAPERCLIP_API_KEY='run-token'");
    expect(shell).toContain("export PAPERCLIP_RUN_ID='run-1'");
    expect(shell).toContain("export PAPERCLIP_TASK_ID='task-1'");
    expect(shell).not.toContain("AGENT_JWT_SECRET");
    expect(shell).not.toContain("PAPERCLIP_PATH");
  });

  it("escapes single quotes so sourcing cannot break out", () => {
    const shell = renderRunEnvShell({ PAPERCLIP_API_KEY: "it's-a'token" });
    expect(shell).toContain(`export PAPERCLIP_API_KEY='it'\\''s-a'\\''token'`);
  });

  it("returns null when no identity var is set", () => {
    expect(renderRunEnvShell({ PATH: "/usr/bin" })).toBeNull();
    expect(renderRunEnvShell({ PAPERCLIP_API_KEY: "" })).toBeNull();
  });
});

describe("runEnvFilePath", () => {
  it("is per run and shell-script shaped", () => {
    const file = runEnvFilePath("d3f35500-12e4-44f9-8b12-91994b76baab");
    expect(file).toContain("paperclip-hermes-runenv-d3f35500-12e4-44f9-8b12-91994b76baab");
    expect(file.endsWith(".sh")).toBe(true);
  });
});

describe("runEnvPromptNote", () => {
  it("tells the agent to source the file before API calls", () => {
    const note = runEnvPromptNote("/tmp/paperclip-hermes-runenv-run-1.sh");
    expect(note).toContain("set -a; . '/tmp/paperclip-hermes-runenv-run-1.sh'; set +a");
    expect(note).toContain("local-board");
  });
});
