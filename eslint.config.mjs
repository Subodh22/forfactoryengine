import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Pragmatic baseline: typescript-eslint recommended (untyped, fast) over the
// three TS packages, plus react-hooks rules for the two UIs. Build scripts
// (*.mjs), packaging dirs and generated output are out of scope.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "desktop/**",
      "cli/**",
      "**/*.mjs",
      "**/*.js",
      "web/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase deliberately uses empty catch for best-effort cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["ui/src/**/*.{ts,tsx}", "web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
