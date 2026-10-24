import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([".git", "node_modules", ".next"]);
const allowedPrefixes = ["src/server/", "scripts/", "tests/"];
const restrictedReference = /\b(?:SUPABASE_SERVICE_ROLE_KEY|createAdminClient)\b/;
const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\./;
const violations: string[] = [];

function inspectDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        inspectDirectory(absolutePath);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    const referenceIsAllowed = allowedPrefixes.some((prefix) =>
      relativePath.startsWith(prefix),
    );

    if (!referenceIsAllowed && restrictedReference.test(content)) {
      violations.push(
        `${relativePath}: restricted server credential/client reference outside an allowed directory`,
      );
    }

    if (jwtPattern.test(content)) {
      violations.push(`${relativePath}: JWT-looking value found`);
    }
  }
}

inspectDirectory(root);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Secret checks passed.");
}
