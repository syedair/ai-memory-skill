# kiro-memory-skill → renamed to `ai-memory-skill`

This package has been renamed. Use:

```bash
npx ai-memory-skill
```

Running `npx kiro-memory-skill` still works — it prints this notice and forwards to `ai-memory-skill`. Existing installs (memory folder, skills, hooks, agent config) are detected and upgraded in place.

If you installed globally:

```bash
npm uninstall -g kiro-memory-skill
npm install -g ai-memory-skill
```

Docs: https://github.com/syedair/ai-memory-skill
