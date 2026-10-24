import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/client/api";
import { httpApi } from "@/lib/client/api-http";

/**
 * HTTP client contract: error JSON is shared via src/server/http helpers —
 * every non-2xx carries {error:{code,message,details?}} and the client must
 * surface it as ApiClientError with status + code.
 */

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api-http error mapping", () => {
  it.each([
    [404, "not_found"],
    [409, "conflict"],
    [422, "validation_failed"],
  ] as const)("maps %d error JSON to ApiClientError", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond(status, { error: { code, message: `status ${status}` } })),
    );
    await expect(httpApi.me()).rejects.toMatchObject({
      status,
      code,
      message: `status ${status}`,
    });
  });

  it("throws ApiClientError (not a raw ZodError) on a malformed 200 body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { unexpected: true })));
    const err = await httpApi.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(200);
    expect((err as ApiClientError).code).toBe("internal");
  });

  it("maps non-contract error bodies to code=internal with the status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(500, "<html>oops</html>")));
    await expect(httpApi.me()).rejects.toMatchObject({ status: 500, code: "internal" });
  });
});
