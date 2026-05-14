import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "evals/**/*.test.ts",
    ],
    // Each LLM eval case can take 60s+; raise default 5s ceiling.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
