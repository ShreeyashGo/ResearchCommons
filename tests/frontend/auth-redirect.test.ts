import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth-redirect";

describe("safeNextPath", () => {
  it("accepts a local path", () => {
    expect(safeNextPath("/g/x")).toBe("/g/x");
  });

  it.each([
    null,
    "",
    "/\n/evil.com",
    "/\t/evil.com",
    "/\r//evil.com",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "g/x",
  ])("falls back to the root for unsafe path %j", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });

  it("keeps encoded controls on the same-origin path", () => {
    const next = safeNextPath("/%0a/evil.com");
    expect(next.startsWith("/")).toBe(true);
    expect(next.startsWith("//")).toBe(false);
  });

  it("preserves query and hash components", () => {
    expect(safeNextPath("/papers/x?tab=1#a")).toBe("/papers/x?tab=1#a");
  });
});
