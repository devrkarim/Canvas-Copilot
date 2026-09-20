import { defineConfig } from "vitest/config";
import path from "node:path";

const here = import.meta.dirname;
export default defineConfig({
  resolve: { alias: { "@": here } },
  test: {
    include: ["tests/**/*.test.ts"],
    env: { APP_DB_PATH: path.join(here, "data", "test.db") },
    globalSetup: ["tests/setup.ts"],
    fileParallelism: false, // suites share one SQLite file
  },
});
