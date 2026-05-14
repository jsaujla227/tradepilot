#!/usr/bin/env node
// Scans markdown files for banned vocabulary (CLAUDE.md vocab banlist).
// Run by lint-staged on staged .md files.

import { readFileSync } from "fs";

const BANNED = [
  "academy", "course", "student", "quiz", "exam", "lesson",
  "module", "certificate", "enroll", "guaranteed", "risk-free",
  "can't lose", "will rise", "will fall", "buy now", "sell now",
];

const pattern = new RegExp(BANNED.map((w) => `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).join("|"), "gi");

const files = process.argv.slice(2);
let failed = false;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const matches = [...line.matchAll(pattern)];
    for (const m of matches) {
      console.error(`${file}:${i + 1}: Banned vocab "${m[0]}" — see CLAUDE.md vocab banlist`);
      failed = true;
    }
  });
}

if (failed) process.exit(1);
