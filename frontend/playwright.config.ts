import { defineConfig } from "@playwright/test";

// Runs against mocked API responses. Tests needing the live backend are added
// once its endpoints exist.
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3217" },
  webServer: {
    command: "npx next dev --port 3217",
    url: "http://localhost:3217",
    reuseExistingServer: true,
    env: {
      NEXT_PUBLIC_USE_MOCKS: "true",
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:3217/mock-api",
      NEXT_PUBLIC_MOCK_DELAY_MS: "50",
    },
  },
});
