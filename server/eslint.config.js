import js from "@eslint/js";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["**/node_modules/**", "coverage/**"]),
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.nodeBuiltin,
    },
    rules: {
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      // Initial maintainability thresholds; review these with the team.
      complexity: ["warn", 10],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 4],
    },
  },
]);
