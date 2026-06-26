import react from "@vitejs/plugin-react";
import type { InlineConfig } from "vitest";
import type { UserConfig } from "vite";

const config = {
  plugins: [react()],
  base: "/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        contact: "contact.html",
        thankYou: "thank-you.html"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: ["node_modules/**", "dist/**", "tests/**"]
  }
} satisfies UserConfig & { test: InlineConfig };

export default config;
