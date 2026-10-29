import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensurePaperclipSkillSymlink, isSameSkillTargetPath } from "./server-utils";

/**
 * Regression: a Paperclip-managed skill linked into `~/.hermes/skills` through a
 * differently-cased path (e.g. `E:\LOCAL\Hive\skills\x` vs `E:\Local\hive\skills\x`)
 * used to be reported as "occupied by another installation", which aborted every
 * heartbeat run of the agent before the model was ever called.
 */
describe("isSameSkillTargetPath", () => {
  it("treats the same path as equal", async () => {
    const p = path.join("C:", "Users", "someone", ".hermes", "skills", "paperclip");
    await expect(isSameSkillTargetPath(p, p)).resolves.toBe(true);
  });

  it("ignores separator style and trailing separators", async () => {
    await expect(
      isSameSkillTargetPath(
        "C:/Users/someone/.hermes/skills/paperclip/",
        "C:\\Users\\someone\\.hermes\\skills\\paperclip",
      ),
    ).resolves.toBe(true);
  });

  it.runIf(process.platform === "win32")("is case-insensitive on Windows", async () => {
    await expect(
      isSameSkillTargetPath(
        "E:\\LOCAL\\Hive\\skills\\memory-documents-read",
        "E:\\Local\\hive\\skills\\memory-documents-read",
      ),
    ).resolves.toBe(true);
  });

  it.runIf(process.platform !== "win32")("stays case-sensitive off Windows", async () => {
    await expect(
      isSameSkillTargetPath("/opt/Hive/skills/x", "/opt/hive/skills/x"),
    ).resolves.toBe(false);
  });

  it("does not equate different targets", async () => {
    await expect(
      isSameSkillTargetPath(
        "C:/Users/someone/.hermes/skills/paperclip",
        "C:/Users/someone/.hermes/skills/memory-documents",
      ),
    ).resolves.toBe(false);
  });

  it("resolves through real links on disk", async () => {
    await expect(
      isSameSkillTargetPath(path.join(root, "skills", "memory-documents-read"), linkTarget),
    ).resolves.toBe(true);
  });
});

let root = "";
let linkTarget = "";

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hive-skill-reconcile-"));
  linkTarget = path.join(root, "skills", "memory-documents-read");
  await fs.mkdir(linkTarget, { recursive: true });
  await fs.writeFile(path.join(linkTarget, "SKILL.md"), "# skill\n", "utf8");
  await fs.mkdir(path.join(root, "hermes-skills"), { recursive: true });
  // Junctions work without elevation on Windows; POSIX uses a normal symlink.
  await fs.symlink(
    linkTarget,
    path.join(root, "hermes-skills", "memory-documents-read"),
    process.platform === "win32" ? "junction" : "dir",
  );
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("ensurePaperclipSkillSymlink", () => {
  it("keeps an existing link that points at the same skill directory", async () => {
    let linkCalls = 0;
    const result = await ensurePaperclipSkillSymlink(
      linkTarget,
      path.join(root, "hermes-skills", "memory-documents-read"),
      async () => {
        linkCalls += 1;
      },
    );
    expect(result).toBe("skipped");
    expect(linkCalls).toBe(0);
  });

  it.runIf(process.platform === "win32")(
    "keeps an existing link reached through a differently-cased source path",
    async () => {
      let linkCalls = 0;
      const differentlyCased = linkTarget
        .split(path.sep)
        .map((segment) => segment.toUpperCase())
        .join(path.sep);
      const result = await ensurePaperclipSkillSymlink(
        differentlyCased,
        path.join(root, "hermes-skills", "memory-documents-read"),
        async () => {
          linkCalls += 1;
        },
      );
      expect(result).toBe("skipped");
      expect(linkCalls).toBe(0);
    },
  );
});
