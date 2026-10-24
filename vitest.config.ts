import { defineConfig } from "vitest/config";

const rlsTestsEnabled = process.env.RLS_TESTS === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "server-only": new URL("./tests/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    exclude: [
      "tests/e2e/**",
      ...(rlsTestsEnabled ? [] : ["tests/rls/**"]),
      "node_modules/**",
      ".next/**",
    ],
  },
});
