# AI Memory Skill

A persistent memory system for AI assistants that remembers context across sessions — and consolidates it like REM sleep. Supports **Kiro** and **Claude Code**.

## How It Works

Three skills work together:
- **load-memory** — Retrieves relevant context when you start a conversation or reference past work
- **update-memory** — Saves important information into categorized, linked markdown files
- **consolidate-memory** — Prunes, deduplicates, and reorganizes memory files (the "dream" cycle)

Two hooks automate the lifecycle:
- **Session start** — Loads `SOUL.md`, `AGENT.md`, `USER.md`, and `MEMORY.md` into context, checks if consolidation is overdue
- **Stop** — Resets session counter after consolidation runs

All memory is stored as plain markdown files in a folder you control (`~/Memory` by default).

## Setup

```bash
npx ai-memory-skill
```

The installer asks which tool you're setting up for — Kiro, Claude Code, or both — then handles everything automatically:

- Creates the memory folder and template files
- Installs the right skills for your tool
- Installs and wires up hooks
- For Kiro: configures knowledge base index and creates an agent
- For Claude Code: merges hooks into `~/.claude/settings.json`

### Upgrading from `kiro-memory-skill`

The package was renamed from `kiro-memory-skill` to `ai-memory-skill` in v3.3.0. To upgrade, run:

```bash
npx ai-memory-skill@latest
```

Your memory folder, skills, hooks, and agent config are detected and upgraded in place — nothing is lost. The old `npx kiro-memory-skill` command still works and forwards to the new package.

If you installed it globally, swap it out:

```bash
npm uninstall -g kiro-memory-skill
npm install -g ai-memory-skill
```

### Manual Install — Claude Code

<details>
<summary>Click to expand</summary>

#### 1. Create the memory folder

```bash
mkdir -p ~/Memory/{People,Knowledge,Decisions,Customers,Personal,Personal/Projects,Reference,Technical,Work,.archive}
```

#### 2. Copy template files

```bash
cp -r memory-template/* ~/Memory/
```

#### 3. Install skills

```bash
cp -r claude-skills/load-memory ~/.claude/skills/
cp -r claude-skills/update-memory ~/.claude/skills/
cp -r claude-skills/consolidate-memory ~/.claude/skills/
```

Replace `<MEMORY_PATH>` in each `SKILL.md` with your memory path (e.g. `~/Memory`).

#### 4. Install hooks

```bash
mkdir -p ~/.claude/hooks
cp hooks/session-start.sh ~/.claude/hooks/memory-session-start.sh
cp hooks/stop.sh ~/.claude/hooks/memory-stop.sh
chmod +x ~/.claude/hooks/memory-session-start.sh ~/.claude/hooks/memory-stop.sh
```

Replace `<MEMORY_PATH>` in both scripts with your expanded memory path (e.g. `/Users/you/Memory`).

#### 5. Wire hooks into Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/memory-session-start.sh" }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "bash ~/.claude/hooks/memory-stop.sh" }]
      }
    ]
  }
}
```

</details>

### Manual Install — Kiro

<details>
<summary>Click to expand</summary>

#### 1. Create the memory folder

```bash
mkdir -p ~/Memory/{People,Knowledge,Decisions,Customers,Personal,Personal/Projects,Reference,Technical,Work,.archive}
```

#### 2. Copy template files

```bash
cp -r memory-template/* ~/Memory/
```

#### 3. Install skills

```bash
cp -r skills/load-memory ~/.kiro/skills/
cp -r skills/update-memory ~/.kiro/skills/
cp -r skills/consolidate-memory ~/.kiro/skills/
```

Replace `<MEMORY_PATH>` in each `SKILL.md` with your memory path.

#### 4. Install hooks

```bash
mkdir -p ~/.kiro/memory-hooks
cp hooks/agent-spawn.sh hooks/stop.sh ~/.kiro/memory-hooks/
chmod +x ~/.kiro/memory-hooks/*.sh
```

Replace `<MEMORY_PATH>` in both scripts with your expanded memory path.

#### 5. Create your agent

```json
{
  "name": "mnemo",
  "description": "AI Memory — persistent context with dream consolidation",
  "tools": ["*"],
  "resources": [
    "skill://~/.kiro/skills/load-memory/SKILL.md",
    "skill://~/.kiro/skills/update-memory/SKILL.md",
    "skill://~/.kiro/skills/consolidate-memory/SKILL.md",
    {
      "type": "knowledgeBase",
      "source": "file://~/Memory",
      "name": "My Memory",
      "description": "User's persistent memory system",
      "indexType": "best",
      "autoUpdate": true
    }
  ],
  "hooks": {
    "agentSpawn": [{ "command": "bash ~/.kiro/memory-hooks/agent-spawn.sh" }],
    "stop": [{ "command": "bash ~/.kiro/memory-hooks/stop.sh" }]
  }
}
```

#### 6. Start chatting

```bash
kiro-cli chat --agent mnemo --trust-all-tools
```

</details>

## Memory Folder Structure

```
~/Memory/
├── SOUL.md                # Agent's core identity, purpose, and principles
├── AGENT.md               # Agent's behavioral rules and communication style
├── MEMORY.md              # Rolling context log — recent activity, active threads
├── USER.md                # Your profile, preferences, role, timezone
├── notes.md               # Raw notes drop zone (processed by update-memory)
├── README.md              # Index of all files
├── .last-dream            # Timestamp of last consolidation (managed by hooks)
├── .session-count         # Session counter (managed by hooks)
├── Personal/              # Life, interests, goals, habits
│   └── Projects/          #   Personal, internal, org-level projects
├── People/                # One file per person or team
├── Knowledge/             # Technical solutions, tools, reference docs
├── Decisions/             # Decision log with rationale
├── Customers/             # One subdirectory per customer company
│   └── <Company>/         #   README.md = company overview, plus engagement files
├── Reference/             # Links, articles, bookmarks, resources
├── Technical/             # Code snippets, configs, architecture notes
├── Work/                  # Meetings, processes, team dynamics, org context
└── .archive/              # Processed notes and consolidation archives
```

## Usage

### Saving to memory

Say:
- "remember this"
- "update memory"
- "save to memory"

Or share important context — the skill triggers automatically when it detects decisions, project details, or preferences worth persisting.

### Loading from memory

Happens automatically via the session-start hook (loads core files into context) and the `load-memory` skill (keyword search for deeper context).

For Claude Code, ask "who am I" or "what have I been working on" to verify context is loading correctly.

### Dream consolidation

Say:
- "dream"
- "consolidate memory"
- "clean up memory"

The hook will also nudge you when consolidation is overdue (3+ days and 5+ sessions since last dream).

The consolidation skill:
1. Reads all memory files
2. Prunes stale entries (preserves them in category folders first)
3. Resolves contradictions (newer wins, old entries annotated)
4. Converts relative dates to absolute
5. Deduplicates across files
6. Archives MEMORY.md entries older than 30 days
7. Updates the dream timestamp and resets the session counter

### Raw notes workflow

1. Drop rough notes into `notes.md`
2. Say "process my notes" or "update memory"
3. The skill categorizes and distributes content to the right files
4. Original notes archived to `.archive/YYYY-MM-DD-notes.md`
5. `notes.md` reset to empty template

## Search

**Kiro** uses semantic search via the built-in knowledge base (configurable as Fast/Lexical or Best/Semantic during setup).

**Claude Code** uses keyword-based grep search across memory files. For semantic search, you can add a vector store MCP server to `~/.claude/settings.json`.

## Customization

### Adjusting consolidation thresholds

Edit the session-start hook script — change the `3` (days) and `5` (sessions) thresholds to your preference.

### Changing the memory path

Re-run the installer (`npx ai-memory-skill`) — it detects existing installs and updates paths without overwriting your data.

## License

MIT — use it however you want.
