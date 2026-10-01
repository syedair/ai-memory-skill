#!/usr/bin/env node

// kiro-memory-skill was renamed to ai-memory-skill. Print the upgrade notice,
// then run the new installer so the old command keeps working.

import { spawnSync } from "node:child_process";

console.log();
console.log("\x1b[33m  ⚠ kiro-memory-skill has been renamed to ai-memory-skill.\x1b[0m");
console.log("  Next time, run: \x1b[36mnpx ai-memory-skill\x1b[0m");
console.log("\x1b[2m  Forwarding to ai-memory-skill now — your existing memory is upgraded in place.\x1b[0m");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npx, ["-y", "ai-memory-skill@latest", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`\n  Could not run ai-memory-skill: ${result.error.message}`);
  console.error("  Run it directly: npx ai-memory-skill@latest\n");
  process.exit(1);
}
process.exit(result.status ?? 1);
