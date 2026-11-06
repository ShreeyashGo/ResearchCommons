import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMe: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/client/api", () => ({
  ApiClientError: class extends Error {},
  API_MOCK: false,
  api: { updateMe: mocks.updateMe },
}));

vi.mock("@/lib/client/supabase", () => ({
  createBrowserSupabaseClient: () => ({
    auth: { updateUser: mocks.updateUser },
  }),
}));

import { updateDisplayName } from "@/lib/client/auth";

describe("updateDisplayName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMe.mockResolvedValue({ profile: { displayName: "Ada" } });
    mocks.updateUser.mockResolvedValue({
      error: { message: "session refresh failed" },
    });
  });

  it("reports when Supabase could not refresh session metadata", async () => {
    await expect(updateDisplayName("Ada")).resolves.toEqual({
      error:
        "Display name saved, but your session couldn't be refreshed. Sign out and back in to see it.",
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: { display_name: "Ada" },
    });
  });
});
