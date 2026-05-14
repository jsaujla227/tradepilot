import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Next's `server-only` guard is a runtime no-op outside Next; stub it
      // so Vitest can pull in modules that import it (lib/alpaca/data, lib/portfolio).
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
