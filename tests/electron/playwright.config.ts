import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
    testDir: ".",
    outputDir: fileURLToPath(new URL("../../.test-tmp/electron", import.meta.url)),
    fullyParallel: false,
    workers: 1,
    timeout: 30_000,
    expect: {
        timeout: 5_000
    },
    reporter: process.env.CI ? "github" : "list",
    use: {
        trace: "retain-on-failure"
    }
});
