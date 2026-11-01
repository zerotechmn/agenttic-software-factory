import { defineConfig, devices } from "@playwright/test";

const external = process.env.BASE_URL;
const port = Number(process.env.E2E_PORT ?? 8799);

export default defineConfig({
  testDir: "tests",
  testMatch: ["e2e/**/*.spec.ts", "acceptance/**/*.spec.ts"],
  timeout: 30_000,
  retries: 0,
  reporter: [["line"]],
  use: { baseURL: external ?? `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        command: `npm run build && PORT=${port} DATABASE_URL=data/e2e.db npm start`,
        url: `http://localhost:${port}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
