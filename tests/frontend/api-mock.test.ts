import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The mock API is an explicit dev-only opt-in: anything but the literal
 * string "1" must take the real HTTP path.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API_MOCK flag", () => {
  it("is false when NEXT_PUBLIC_API_MOCK is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "");
    const { API_MOCK } = await import("@/lib/client/api");
    expect(API_MOCK).toBe(false);
  });

  it("is false for non-'1' values", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "true");
    const { API_MOCK } = await import("@/lib/client/api");
    expect(API_MOCK).toBe(false);
  });

  it("is true only for the literal '1'", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    vi.resetModules();
    const { API_MOCK } = await import("@/lib/client/api");
    expect(API_MOCK).toBe(true);
  });

  it("updates the mock profile and rejects an empty display name", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCK", "1");
    const { api } = await import("@/lib/client/api");
    await api.updateMe({ displayName: "  Grace Hopper  " });
    expect((await api.me()).profile.displayName).toBe("Grace Hopper");
    await expect(api.updateMe({ displayName: "" })).rejects.toThrow();
  });
});
