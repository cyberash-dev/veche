import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		testTimeout: 10_000,
		hookTimeout: 30_000,
		globals: false,
	},
});
