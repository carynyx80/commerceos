import { readFileSync, existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// e2e tests call agent-core/commerce directly, so they need the worker's local devnet env.
const env: Record<string, string> = {};
for (const f of ["../worker/.env", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
}

export default defineConfig({
  test: { testTimeout: 120_000, hookTimeout: 60_000, fileParallelism: false, include: ["test/**/*.test.ts"], env },
});
