import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth-redirect";

describe("safeNextPath", () => {
  it("accepts a local path", () => {
    expect(safeNextPath("/g/x")).toBe("/g/x");
  });

  it.each([
    null,
    "",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "g/x",
  ])("falls back to the root for unsafe path %j", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });
});
