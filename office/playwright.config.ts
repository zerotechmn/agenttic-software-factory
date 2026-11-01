import { defineConfig, devices } from "@playwright/test";

const external = process.env.BASE_URL;
const port = Number(process.env.E2E_PORT ?? 8799);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  reporter: [["line"]],
  use: { baseURL: external ?? `http://127.0.0.1:${port}`, viewport: { width: 1920, height: 1080 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } }],
  webServer: external ? undefined : { command: `npm run build && PORT=${port} npm start`, url: `http://127.0.0.1:${port}/`, reuseExistingServer: false, timeout: 120_000 },
});
