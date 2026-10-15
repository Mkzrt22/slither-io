import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components: neutral in unit tests.
      "server-only": fileURLToPath(new URL("./tests/setup/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
    env: {
      LLM_PROVIDER: "mock",
      MOCK_LLM_DELAY_MS: "0",
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
      SUPABASE_SERVICE_ROLE_KEY: "test-service",
    },
    coverage: { provider: "v8", include: ["src/lib/**"] },
  },
});
