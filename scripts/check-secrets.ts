import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const skippedDirectories = new Set([".git", "node_modules", ".next"]);
const skippedDirectoryPaths = new Set(["supabase/.temp"]);
const allowedPrefixes = ["src/server/", "scripts/", "tests/"];
const serviceRoleKeyReference = /\bSUPABASE_SERVICE_ROLE_KEY\b/;
const adminClientReference = /\bcreateAdminClient\b/;
const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\./;
const violations: string[] = [];

function inspectDirectory(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (
        !skippedDirectories.has(entry.name) &&
        !skippedDirectoryPaths.has(relativePath)
      ) {
        inspectDirectory(absolutePath);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    const codeReferenceIsAllowed = allowedPrefixes.some((prefix) =>
      relativePath.startsWith(prefix),
    );

    if (
      (serviceRoleKeyReference.test(content) &&
        !codeReferenceIsAllowed &&
        relativePath !== ".env.example") ||
      (adminClientReference.test(content) &&
        !codeReferenceIsAllowed &&
        relativePath !== "docs/architecture.md")
    ) {
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
