#!/usr/bin/env bash
# agentSpawn hook: loads core identity files into context and checks consolidation staleness
# STDOUT is injected into the agent's context automatically by Kiro

MEMORY_PATH="<MEMORY_PATH>"
MEMORY_FILE="$MEMORY_PATH/MEMORY.md"
SOUL_FILE="$MEMORY_PATH/SOUL.md"
AGENT_FILE="$MEMORY_PATH/AGENT.md"
USER_FILE="$MEMORY_PATH/USER.md"
DREAM_FILE="$MEMORY_PATH/.last-dream"
SESSION_FILE="$MEMORY_PATH/.session-count"

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
if [ -f "$SESSION_FILE" ]; then
  raw=$(cat "$SESSION_FILE" 2>/dev/null || echo 0)
  # Validate numeric content to prevent arithmetic injection
  if echo "$raw" | grep -qE '^[0-9]+$'; then
    count=$raw
  fi
fi
count=$((count + 1))
echo "$count" > "$SESSION_FILE"

# Check staleness
if [ -f "$DREAM_FILE" ]; then
  raw_dream=$(cat "$DREAM_FILE" 2>/dev/null || echo "")
  # Validate numeric content before arithmetic use
  if echo "$raw_dream" | grep -qE '^[0-9]+$'; then
    last_dream=$raw_dream
    now=$(date +%s)
    age=$(( (now - last_dream) / 86400 ))
    if [ "$age" -ge 3 ] && [ "$count" -ge 5 ]; then
      echo ""
      echo "⚠ Memory hasn't been consolidated in ${age} days (${count} sessions). Consider saying 'dream' or 'consolidate memory' to clean up."
    fi
  fi
else
  if [ "$count" -ge 5 ]; then
    echo ""
    echo "⚠ Memory has never been consolidated (${count} sessions so far). Consider saying 'dream' or 'consolidate memory'."
  fi
fi
