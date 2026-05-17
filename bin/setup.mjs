#!/usr/bin/env node

import { createInterface } from "node:readline";
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const PKG_VERSION = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8")).version;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function expandHome(p) {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

// Security: validate memory path to prevent shell injection when interpolated into scripts
function validateMemoryPath(p) {
  // Reject null bytes and control characters
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(p)) {
    return "Path contains invalid control characters.";
  }
  // Reject newlines (could break shell script structure)
  if (/[\n\r]/.test(p)) {
    return "Path cannot contain newlines.";
  }
  // Reject shell metacharacters that could cause injection when path is
  // interpolated into double-quoted strings in shell scripts
  if (/[`$|;&(){}\[\]!\\]/.test(p)) {
    return "Path contains shell metacharacters (` $ | ; & ( ) { } [ ] ! \\) that are not allowed.";
  }
  // Reject path traversal attempts
  if (/(^|\/)\.\.($|\/)/.test(p)) {
    return "Path cannot contain '..' traversal segments.";
  }
  return null;
}

// Security: validate agent name to prevent path injection or unexpected file names
function validateAgentName(name) {
  if (!name || name.length === 0) {
    return "Agent name cannot be empty.";
  }
  if (name.length > 64) {
    return "Agent name cannot exceed 64 characters.";
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return "Agent name can only contain letters, numbers, hyphens, and underscores.";
  }
  return null;
}

function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s) { return `\x1b[33m${s}\x1b[0m`; }
function cyan(s) { return `\x1b[36m${s}\x1b[0m`; }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }

// Detect if this is a fresh install or upgrade
function detectInstall(memPath) {
  const markers = [
    join(memPath, "MEMORY.md"),
    expandHome("~/.kiro/skills/load-memory/SKILL.md"),
    expandHome("~/.kiro/memory-hooks/agent-spawn.sh"),
  ];
  return markers.some(f => existsSync(f)) ? "upgrade" : "fresh";
}

// Read installed version from memory folder marker
function getInstalledVersion(memPath) {
  const vFile = join(memPath, ".kiro-memory-version");
  if (existsSync(vFile)) return readFileSync(vFile, "utf-8").trim();
  // Pre-version installs
  if (existsSync(join(memPath, "MEMORY.md"))) return "unknown";
  return null;
}

function stampVersion(memPath) {
  writeFileSync(join(memPath, ".kiro-memory-version"), PKG_VERSION + "\n");
}

// Deep merge agent config: preserve user customizations, update memory-managed fields
function mergeAgentConfig(existing, incoming) {
  const merged = { ...existing };

  // Always update description to latest
  merged.description = incoming.description;

  // Merge resources: replace memory skill refs + knowledgeBase, keep user-added ones
  const isMemoryResource = (r) => {
    if (typeof r === "string") return r.includes("load-memory") || r.includes("update-memory") || r.includes("consolidate-memory");
    if (r && r.type === "knowledgeBase" && r.name === "My Memory") return true;
    return false;
  };
  const userResources = (existing.resources || []).filter(r => !isMemoryResource(r));
  merged.resources = [...incoming.resources, ...userResources];

  // Merge hooks: replace memory hooks, keep user-added ones
  const isMemoryHook = (h) => h.command && (h.command.includes("memory-hooks") || h.command.includes("agent-spawn") || h.command.includes("stop.sh"));

  for (const hookType of ["agentSpawn", "stop"]) {
    const existingHooks = (existing.hooks && existing.hooks[hookType]) || [];
    const userHooks = existingHooks.filter(h => !isMemoryHook(h));
    const incomingHooks = (incoming.hooks && incoming.hooks[hookType]) || [];
    if (!merged.hooks) merged.hooks = {};
    merged.hooks[hookType] = [...incomingHooks, ...userHooks];
  }
  // Preserve other hook types the user may have added
  if (existing.hooks) {
    for (const key of Object.keys(existing.hooks)) {
      if (key !== "agentSpawn" && key !== "stop") {
        if (!merged.hooks) merged.hooks = {};
        merged.hooks[key] = existing.hooks[key];
      }
    }
  }

  // Preserve user customizations
  if (existing.mcpServers && Object.keys(existing.mcpServers).length) merged.mcpServers = existing.mcpServers;
  if (existing.tools) merged.tools = existing.tools;
  if (existing.toolAliases && Object.keys(existing.toolAliases).length) merged.toolAliases = existing.toolAliases;
  if (existing.allowedTools && existing.allowedTools.length) merged.allowedTools = existing.allowedTools;
  if (existing.toolsSettings && Object.keys(existing.toolsSettings).length) merged.toolsSettings = existing.toolsSettings;
  if (existing.prompt) merged.prompt = existing.prompt;
  if (existing.model) merged.model = existing.model;
  if (existing.includeMcpJson) merged.includeMcpJson = existing.includeMcpJson;

  return merged;
}

function buildAgentConfig(name, hooksDir, memPath, indexType) {
  return {
    name,
    description: "Kiro Memory — persistent context with dream consolidation",
    prompt: null,
    mcpServers: {},
    tools: ["*"],
    toolAliases: {},
    allowedTools: [],
    resources: [
      "skill://~/.kiro/skills/load-memory/SKILL.md",
      "skill://~/.kiro/skills/update-memory/SKILL.md",
      "skill://~/.kiro/skills/consolidate-memory/SKILL.md",
      {
        type: "knowledgeBase",
        source: `file://${memPath}`,
        name: "My Memory",
        description: "User's persistent memory system — projects, people, decisions, knowledge",
        indexType,
        autoUpdate: true
      }
    ],
    hooks: {
      agentSpawn: [
        { command: `bash ${hooksDir}/agent-spawn.sh` }
      ],
      stop: [
        { command: `bash ${hooksDir}/stop.sh` }
      ]
    },
    toolsSettings: {},
    includeMcpJson: false,
    model: null
  };
}

function copyDirSkipExisting(src, dest) {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
      copyDirSkipExisting(srcPath, destPath);
    } else if (!existsSync(destPath)) {
      cpSync(srcPath, destPath);
    }
  }
}

async function main() {
  console.log();
  console.log(cyan("  AI Memory — Setup"));
  console.log(dim(`  v${PKG_VERSION} — Persistent memory with dream consolidation\n`));

  // 0. Which AI tool?
  console.log(`  Which AI tool are you setting up for?`);
  console.log(dim(`    1) Kiro`));
  console.log(dim(`    2) Claude Code`));
  console.log(dim(`    3) Both`));
  const toolChoice = (await ask(`  Choose ${dim("(1/2/3, default: 2)")}: `)).trim() || "2";
  const installKiro = toolChoice === "1" || toolChoice === "3";
  const installClaude = toolChoice === "2" || toolChoice === "3";

  if (installKiro) {
    try {
      execSync("which kiro-cli", { stdio: "ignore" });
    } catch {
      console.log(yellow("\n  ⚠ kiro-cli not found on your PATH."));
      console.log(`  Install it from: ${cyan("https://kiro.dev/docs/cli/install")}`);
      const cont = (await ask(`\n  Continue anyway? ${dim("(y/N)")}: `)).trim().toLowerCase();
      if (cont !== "y") {
        console.log(dim("\n  Setup cancelled. Install kiro-cli and try again.\n"));
        rl.close();
        return;
      }
    }
  }

  // 1. Memory folder path
  const rawMemPath = (await ask(`  Memory folder path ${dim("(~/Memory)")}: `)).trim() || "~/Memory";
  const pathError = validateMemoryPath(rawMemPath);
  if (pathError) {
    console.log(yellow(`\n  ✗ Invalid memory path: ${pathError}`));
    console.log(dim("  Use a simple path like ~/Memory or ~/Documents/memory\n"));
    rl.close();
    return;
  }
  const memPath = expandHome(rawMemPath);

  const mode = detectInstall(memPath);
  const installedVersion = getInstalledVersion(memPath);

  if (mode === "upgrade") {
    const vLabel = installedVersion === "unknown" ? "pre-3.0" : `v${installedVersion}`;
    console.log(cyan(`\n  Upgrading from ${vLabel} → v${PKG_VERSION}`));
    console.log(dim("  Your memory data and customizations will be preserved.\n"));
  }

  // 2. Create memory folder + subdirs (additive — never deletes)
  const dirs = ["People", "Knowledge", "Decisions", "Customers", "Personal", "Personal/Projects", "Reference", "Technical", "Work", ".archive"];
  if (!existsSync(memPath)) mkdirSync(memPath, { recursive: true });
  let newDirs = [];
  for (const d of dirs) {
    const dirPath = join(memPath, d);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      newDirs.push(d);
    }
  }

  // 3. Copy template files (skip existing — never overwrites user data)
  const templateDir = join(pkgRoot, "memory-template");
  copyDirSkipExisting(templateDir, memPath);
  stampVersion(memPath);

  if (newDirs.length > 0) {
    console.log(green("  ✓ Added new folders: ") + newDirs.join(", "));
  }
  console.log(green("  ✓ Memory folder ready at ") + memPath);

  // ── KIRO INSTALL ────────────────────────────────────────────────────────────
  let hooksDir;
  if (installKiro) {
    // 4. Install skills (always overwrite — skills are managed, not customized)
    const kiroSkillsDir = expandHome("~/.kiro/skills");
    mkdirSync(kiroSkillsDir, { recursive: true });

    const skills = ["load-memory", "update-memory", "consolidate-memory"];
    const srcSkillsDir = join(pkgRoot, "skills");

    for (const skill of skills) {
      const dest = join(kiroSkillsDir, skill);
      cpSync(join(srcSkillsDir, skill), dest, { recursive: true, force: true });

      const skillFile = join(dest, "SKILL.md");
      const content = readFileSync(skillFile, "utf-8");
      writeFileSync(skillFile, content.replace(/<MEMORY_PATH>/g, rawMemPath));
    }
    console.log(green("  ✓ Kiro skills installed to ") + kiroSkillsDir + dim(` (memory path: ${rawMemPath})`));

    // 5. Install Kiro hooks (always overwrite — hooks are managed, not customized)
    hooksDir = expandHome("~/.kiro/memory-hooks");
    mkdirSync(hooksDir, { recursive: true });

    const srcHooksDir = join(pkgRoot, "hooks");
    const kiroHooks = ["agent-spawn.sh", "stop.sh"];
    for (const hookFile of kiroHooks) {
      const src = join(srcHooksDir, hookFile);
      if (!existsSync(src)) continue;
      const dest = join(hooksDir, hookFile);
      const content = readFileSync(src, "utf-8");
      writeFileSync(dest, content.replace(/<MEMORY_PATH>/g, expandHome(rawMemPath)));
      chmodSync(dest, 0o755);
    }
    console.log(green("  ✓ Kiro hooks installed to ") + hooksDir);
  }

  // ── CLAUDE CODE INSTALL ──────────────────────────────────────────────────
  if (installClaude) {
    // Claude skills
    const claudeSkillsDir = expandHome("~/.claude/skills");
    mkdirSync(claudeSkillsDir, { recursive: true });

    const claudeSkills = ["load-memory", "update-memory", "consolidate-memory"];
    const srcClaudeSkillsDir = join(pkgRoot, "claude-skills");

    for (const skill of claudeSkills) {
      const dest = join(claudeSkillsDir, skill);
      cpSync(join(srcClaudeSkillsDir, skill), dest, { recursive: true, force: true });
      const skillFile = join(dest, "SKILL.md");
      const content = readFileSync(skillFile, "utf-8");
      writeFileSync(skillFile, content.replace(/<MEMORY_PATH>/g, rawMemPath));
    }
    console.log(green("  ✓ Claude Code skills installed to ") + claudeSkillsDir);

    // Claude hooks
    const claudeHooksDir = expandHome("~/.claude/hooks");
    mkdirSync(claudeHooksDir, { recursive: true });

    const srcHooksDir = join(pkgRoot, "hooks");
    const claudeHookMap = { "session-start.sh": "memory-session-start.sh", "stop.sh": "memory-stop.sh" };
    for (const [src, dest] of Object.entries(claudeHookMap)) {
      const srcPath = join(srcHooksDir, src);
      if (!existsSync(srcPath)) continue;
      const destPath = join(claudeHooksDir, dest);
      const content = readFileSync(srcPath, "utf-8");
      writeFileSync(destPath, content.replace(/<MEMORY_PATH>/g, expandHome(rawMemPath)));
      chmodSync(destPath, 0o755);
    }
    console.log(green("  ✓ Claude Code hooks installed to ") + claudeHooksDir);

    // Merge into ~/.claude/settings.json
    const claudeSettingsPath = expandHome("~/.claude/settings.json");
    let settings = {};
    if (existsSync(claudeSettingsPath)) {
      settings = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
    }
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    if (!settings.hooks.Stop) settings.hooks.Stop = [];

    const claudeHooksDir2 = expandHome("~/.claude/hooks");
    const sessionStartCmd = `bash "${claudeHooksDir2}/memory-session-start.sh"`;
    const stopCmd = `bash "${claudeHooksDir2}/memory-stop.sh"`;

    const hasSessionStart = settings.hooks.SessionStart.some(g => g.hooks?.some(h => h.command?.includes("memory-session-start.sh")));
    const hasStop = settings.hooks.Stop.some(g => g.hooks?.some(h => h.command?.includes("memory-stop.sh")));

    if (!hasSessionStart) settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: sessionStartCmd }] });
    if (!hasStop) settings.hooks.Stop.push({ hooks: [{ type: "command", command: stopCmd }] });

    writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(green("  ✓ Claude Code hooks wired into ") + claudeSettingsPath);
  }

  if (!installKiro && !installClaude) {
    console.log(yellow("  ⚠ No tool selected, skipping tool-specific install."));
  }

  let indexType = "best";
  if (installKiro) {
    // 6. Knowledge base index type
    console.log();
    console.log(`  Knowledge Base index type:`);
    console.log(dim(`    1) Fast (Lexical — bm25)`));
    console.log(dim(`    2) Best (Semantic — all-minilm-l6-v2)`));
    const indexChoice = (await ask(`  Choose index type ${dim("(1/2, default: 2)")}: `)).trim() || "2";
    indexType = indexChoice === "1" ? "fast" : "best";

    const cliSettingsPath = expandHome("~/.kiro/settings/cli.json");
    let cliSettings = {};
    if (existsSync(cliSettingsPath)) {
      cliSettings = JSON.parse(readFileSync(cliSettingsPath, "utf-8"));
    } else {
      mkdirSync(dirname(cliSettingsPath), { recursive: true });
    }
    cliSettings["knowledge.indexType"] = indexType === "fast" ? "Fast" : "Best";
    writeFileSync(cliSettingsPath, JSON.stringify(cliSettings, null, 2) + "\n");
    console.log(green(`  ✓ Index type set to ${indexType}`));

    // 7. Create or merge agent config
    const agentName = (await ask(`\n  Agent name ${dim("(mnemo)")}: `)).trim() || "mnemo";
    const nameError = validateAgentName(agentName);
    if (nameError) {
      console.log(yellow(`\n  ✗ Invalid agent name: ${nameError}`));
      console.log(dim("  Use only letters, numbers, hyphens, and underscores.\n"));
      rl.close();
      return;
    }
    const agentsDir = expandHome("~/.kiro/agents");
    mkdirSync(agentsDir, { recursive: true });

    const agentFile = join(agentsDir, `${agentName}.json`);
    const incoming = buildAgentConfig(agentName, hooksDir, rawMemPath, indexType);

    if (existsSync(agentFile)) {
      const existing = JSON.parse(readFileSync(agentFile, "utf-8"));
      const merged = mergeAgentConfig(existing, incoming);
      writeFileSync(agentFile, JSON.stringify(merged, null, 2) + "\n");

      const preserved = [];
      if (existing.mcpServers && Object.keys(existing.mcpServers).length) preserved.push("MCP servers");
      if (existing.prompt) preserved.push("custom prompt");
      if (existing.model) preserved.push("model");
      const userResources = (existing.resources || []).filter(r => {
        if (typeof r === "string") return !r.includes("load-memory") && !r.includes("update-memory") && !r.includes("consolidate-memory");
        if (r && r.type === "knowledgeBase" && r.name === "My Memory") return false;
        return true;
      });
      if (userResources.length) preserved.push(`${userResources.length} custom resource(s)`);

      if (preserved.length) {
        console.log(green(`  ✓ Agent "${agentName}" updated — preserved: `) + preserved.join(", "));
      } else {
        console.log(green(`  ✓ Agent "${agentName}" updated`));
      }
    } else {
      writeFileSync(agentFile, JSON.stringify(incoming, null, 2) + "\n");
      console.log(green(`  ✓ Agent "${agentName}" created at `) + agentFile);
    }
  }

  // 8. Done
  console.log();
  if (mode === "upgrade") {
    console.log(cyan("  Upgrade complete! Your memory data is untouched."));
    console.log(dim("  Skills, hooks, and agent config have been updated to v" + PKG_VERSION));
  } else {
    console.log(cyan("  All set!"));
  }
  if (installKiro) console.log(dim(`  Kiro: kiro-cli chat --agent mnemo --trust-all-tools`));
  if (installClaude) console.log(dim(`  Claude Code: start a new session and ask "who am I"`));
  console.log();

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
