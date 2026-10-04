import js from "@eslint/js";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["tests/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        URL: "readonly",
        window: "readonly",
        MODE_SETTINGS: "readonly",
        activeBenchmarkScope: "readonly",
        lastJsonExport: "readonly",
        createTrackedAbortController: "readonly",
        DOMException: "readonly",
        document: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
];
