import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/server/env";

describe("server environment", () => {
  it("requires a Gemini key when Gemini is selected", () => {
    expect(() =>
      parseServerEnv({
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
        AI_PROVIDER: "gemini",
      }),
    ).toThrow(/GEMINI_API_KEY is required/);
  });
});
