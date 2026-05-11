import js from "@eslint/js";
import * as tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default [
  {
    ignores: [".vite/**", "dist/**", "vite.config.ts", "vitest.config.ts"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "tsconfig.json",
      },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // SolidJS ref pattern: `let ref; <div ref={ref} />` assigns via callback
      "no-unassigned-vars": "off",
      // Use TS-aware version that understands _ prefix and type imports
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
