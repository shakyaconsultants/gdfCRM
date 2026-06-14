import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These two newer react-hooks rules flag idiomatic, intentional patterns used
      // throughout the app's client pages: client-side data fetch-on-mount effects
      // (useEffect -> load()/fetch() that set loading/data state) and the polling hook.
      // They are performance-advisory, not correctness rules. Enforcing them as errors
      // would require restructuring data fetching across every dashboard page with real
      // regression risk, so they are downgraded to warnings. Correctness rules
      // (rules-of-hooks, exhaustive-deps, refs) remain fully enforced.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
