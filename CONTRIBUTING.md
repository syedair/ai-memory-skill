# Contributing

## Repo layout

| Path | What it is |
|------|------------|
| `bin/setup.mjs` | The installer that `npx ai-memory-skill` runs |
| `skills/` | Kiro skills (installed to `~/.kiro/skills/`) |
| `claude-skills/` | Claude Code skills (installed to `~/.claude/skills/`) |
| `hooks/` | Hook scripts. `agent-spawn.sh` is Kiro-only, `session-start.sh` is Claude Code-only, `stop.sh` is shared |
| `memory-template/` | Starter files copied into the user's memory folder (never overwrites existing files) |
| `legacy/kiro-memory-skill/` | Forwarder published under the old package name; runs `npx ai-memory-skill@latest` |

`<MEMORY_PATH>` in skills and hooks is a placeholder that the installer replaces at install time.

## Testing the installer locally

Install into a throwaway home directory so your real `~/.claude`, `~/.kiro` and `~/Memory` are untouched:

```bash
npm pack --pack-destination /tmp
mkdir -p /tmp/fakehome
HOME=/tmp/fakehome npx -y --package=/tmp/ai-memory-skill-<version>.tgz ai-memory-skill
```

Answers can be piped in for a non-interactive run, e.g. `printf '2\n\n' | ...` picks Claude Code with the default memory path.

To check a hook, run the installed copy with an empty event: `echo '{}' | bash /tmp/fakehome/.claude/hooks/memory-session-start.sh`.

## Releasing

Two packages are published from this repo:

- `ai-memory-skill` — the real package (repo root)
- `kiro-memory-skill` — the forwarder for the old name (`legacy/kiro-memory-skill/`)

Both publish from `.github/workflows/publish.yml` using npm trusted publishing (OIDC). No npm token is stored in the repo.

1. Bump `version` in **both** `package.json` and `legacy/kiro-memory-skill/package.json`. Keep them in step so the old name's latest version matches the new one.
2. Merge to `main`.
3. Trigger the publish, either way:
   - **Tag:** create a new `vX.Y.Z` tag on `main`, e.g. via a GitHub release with "Create new tag on publish". The tag must not already exist; a release attached to an existing tag doesn't trigger the workflow.
   - **Manual:** Actions → "Publish to npm" → Run workflow on `main`.
4. Check the run. Versions already on npm are skipped (`already published, skipping`), so re-running is safe.

### Gotchas

- Trusted publishing needs npm ≥ 11.5.1; the workflow pins Node 24 for that. Don't drop it to an older Node.
- Each package's npm Trusted Publisher must point at repo `ai-memory-skill` and workflow `publish.yml`. If the repo or workflow file is renamed, update both packages on npmjs.com, or publishes fail.
- A brand-new package name can't use trusted publishing for its first version. Publish it once manually (`npm login && npm publish --access public`), then add the Trusted Publisher.
