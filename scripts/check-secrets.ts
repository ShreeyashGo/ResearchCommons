import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const allowedPrefixes = ["src/server/", "scripts/", "tests/"];
const serviceRoleKeyReference = /\bSUPABASE_SERVICE_ROLE_KEY\b/;
const adminClientReference = /\bcreateAdminClient\b/;
const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\./;
const violations: string[] = [];

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .split(/\r?\n/u)
  .filter(Boolean);

for (const file of files) {
  const relativePath = file.split(path.sep).join("/");
  const absolutePath = path.join(root, file);
  if (!existsSync(absolutePath)) {
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

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Secret checks passed.");
}
