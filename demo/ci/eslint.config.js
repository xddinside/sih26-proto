import root from "../../eslint.config.js"

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
