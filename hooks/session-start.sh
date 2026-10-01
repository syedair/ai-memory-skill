#!/usr/bin/env bash
# Claude Code SessionStart hook: loads core identity files into context and checks consolidation staleness
# STDOUT of a SessionStart hook is added to Claude's context automatically

MEMORY_PATH="<MEMORY_PATH>"
SOUL_FILE="$MEMORY_PATH/SOUL.md"
AGENT_FILE="$MEMORY_PATH/AGENT.md"
USER_FILE="$MEMORY_PATH/USER.md"
MEMORY_FILE="$MEMORY_PATH/MEMORY.md"
DREAM_FILE="$MEMORY_PATH/.last-dream"
SESSION_FILE="$MEMORY_PATH/.session-count"

# Drain the hook event JSON from stdin
cat > /dev/null

# Load core files into context
for label_file in "Soul:$SOUL_FILE" "Agent:$AGENT_FILE" "User:$USER_FILE" "Memory:$MEMORY_FILE"; do
  label="${label_file%%:*}"
  file="${label_file#*:}"
  if [ -f "$file" ]; then
    echo "=== ${label} Context (auto-loaded) ==="
    head -200 "$file"
    echo "=== End ${label} Context ==="
    echo ""
  fi
done

# Increment session counter
count=0
[ -f "$SESSION_FILE" ] && count=$(cat "$SESSION_FILE" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$SESSION_FILE"

# Check staleness
if [ -f "$DREAM_FILE" ]; then
  last_dream=$(cat "$DREAM_FILE")
  now=$(date +%s)
  age=$(( (now - last_dream) / 86400 ))
  if [ "$age" -ge 3 ] && [ "$count" -ge 5 ]; then
    echo ""
    echo "⚠ Memory hasn't been consolidated in ${age} days (${count} sessions). Consider saying 'dream' or 'consolidate memory' to clean up."
  fi
else
  if [ "$count" -ge 5 ]; then
    echo ""
    echo "⚠ Memory has never been consolidated (${count} sessions so far). Consider saying 'dream' or 'consolidate memory'."
  fi
fi
