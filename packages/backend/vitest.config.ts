import { defineConfig } from "vitest/config";

const databaseIntegrationEnabled = Boolean(
  process.env.EXPORT_IMPORT_TEST_DATABASE_URL ||
    process.env.REVISION_TEST_DATABASE_URL ||
    process.env.RENAME_REFACTOR_TEST_DATABASE_URL,
);
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // CI points the PostgreSQL integration suites at one migrated database.
    // Run those files sequentially so Serializable/RepeatableRead predicate
    // locks from unrelated fixtures cannot create schedule-dependent failures.
    fileParallelism: !databaseIntegrationEnabled,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: [
        "src/useCases/ai/runtime/taskContract.ts",
        "src/useCases/ai/runtime/modelPricing.ts",
        "src/useCases/ai/tools/capabilities.ts",
        "src/useCases/ai/prompts/untrustedData.ts",
        "src/evals/continuityBenchmark.ts",
      ],
      thresholds: {
        "src/useCases/ai/runtime/taskContract.ts": {
          statements: 70,
          branches: 60,
          functions: 70,
          lines: 70,
        },
        "src/useCases/ai/runtime/modelPricing.ts": {
          statements: 80,
          branches: 60,
          functions: 90,
          lines: 90,
        },
        "src/useCases/ai/tools/capabilities.ts": {
          statements: 70,
          branches: 55,
          functions: 85,
          lines: 75,
        },
        "src/useCases/ai/prompts/untrustedData.ts": {
          statements: 100,
          branches: 50,
          functions: 100,
          lines: 100,
        },
        "src/evals/continuityBenchmark.ts": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 85,
        },
      },
    },
  },
});
