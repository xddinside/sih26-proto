import root from "../../eslint.config.js"

// The root TanStack ESLint config targets React frontend code. The Control
// Plane is a no-framework backend service; relax the type-aware rules that
// produce false positives on its data-heavy code while keeping the rest.
export default [
  ...root,
  {
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/method-signature-style": "off",
    },
  },
]
