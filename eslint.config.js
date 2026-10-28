import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      ".agents/**",
      ".claude/**",
      ".codegraph/**",
      ".codex/**",
      ".vercel/**",
      ".local/**",
      "coverage/**",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  {
    files: ["*.js"],
    extends: [eslint.configs.recommended],
  },
  {
    files: ["{api,src,scripts,tests}/**/*.ts"],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "simple-import-sort/imports": [
        "error",
        { groups: [["^\\u0000", "^node:", "^@?\\w", "^", "^\\."]] },
      ],
      "simple-import-sort/exports": "error",
    },
  },
]);
