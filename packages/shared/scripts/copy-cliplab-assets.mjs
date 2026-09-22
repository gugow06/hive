import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(packageRoot, "src", "cliplab");
const outDir = join(packageRoot, "dist", "cliplab");

mkdirSync(outDir, { recursive: true });
for (const file of ["LICENSE", "PROVENANCE.md"]) {
  copyFileSync(join(srcDir, file), join(outDir, file));
}
