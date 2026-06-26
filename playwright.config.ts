import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: existsSync(chromePath) ? { executablePath: chromePath } : undefined
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000
  }
});
