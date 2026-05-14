import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Inline plugin — checks JSX text and string literals for banned vocabulary.
// Words that must never appear in the UI (CLAUDE.md vocab banlist).
const BANNED_WORDS = [
  "academy",
  "course",
  "student",
  "quiz",
  "exam",
  "lesson",
  "module",
  "certificate",
  "enroll",
  "guaranteed",
  "risk-free",
  "can't lose",
  "will rise",
  "will fall",
  "buy now",
  "sell now",
];

const banPattern = new RegExp(
  BANNED_WORDS.map((w) => `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).join("|"),
  "i",
);

const vocabPlugin = {
  rules: {
    "no-banned-vocab": {
      meta: { type: "problem", schema: [] },
      create(context) {
        const filename = context.filename ?? context.getFilename?.() ?? "";
        const isJsx = filename.endsWith(".tsx") || filename.endsWith(".jsx");
        if (!isJsx) return {};

        return {
          JSXText(node) {
            const text = node.value.trim();
            if (text && banPattern.test(text)) {
              const match = text.match(banPattern);
              context.report({
                node,
                message: `Banned vocab "${match?.[0]}" in JSX text. See CLAUDE.md vocab banlist.`,
              });
            }
          },
          Literal(node) {
            if (typeof node.value === "string" && banPattern.test(node.value)) {
              const match = node.value.match(banPattern);
              context.report({
                node,
                message: `Banned vocab "${match?.[0]}" in string literal. See CLAUDE.md vocab banlist.`,
              });
            }
          },
        };
      },
    },
  },
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: { vocab: vocabPlugin },
    rules: { "vocab/no-banned-vocab": "error" },
    files: ["**/*.tsx", "**/*.jsx"],
  },
];

export default eslintConfig;
