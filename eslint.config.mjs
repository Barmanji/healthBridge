import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Python side (see ML.md) is linted by pytest/ruff conventions, not ESLint. Its
    // virtualenv ships third-party JavaScript that is not ours to lint.
    "ml/.venv/**",
  ]),
]);

export default eslintConfig;
