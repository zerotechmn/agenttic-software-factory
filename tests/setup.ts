import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Tests never touch the real lessons file: each worker gets a copy of the seed.
const dir = mkdtempSync(join(tmpdir(), "forge-lessons-"));
copyFileSync(join(__dirname, "..", "lessons", "lessons.json"), join(dir, "lessons.json"));
process.env.FORGE_LESSONS = join(dir, "lessons.json");
