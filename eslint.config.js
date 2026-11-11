// SPDX-License-Identifier: AGPL-3.0-only
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/", "**/*.d.mts", "node_modules/", ".pnpm-store/"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // node:test's describe/it return promises that the runner tracks itself.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      // Failure messages interpolate seeds and day counts.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    // The UI builds HTML strings with counts and dates; numbers in templates are fine there.
    files: ["packages/web-ui/**/*.ts", "packages/storage/**/*.ts"],
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  { files: ["**/*.mjs", "eslint.config.js"], ...tseslint.configs.disableTypeChecked },
);
