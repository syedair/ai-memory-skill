#!/usr/bin/env bash
# Claude Code SessionStart hook: loads core identity files into context via additionalContext

MEMORY_PATH="<MEMORY_PATH>"
SOUL_FILE="$MEMORY_PATH/SOUL.md"
AGENT_FILE="$MEMORY_PATH/AGENT.md"
USER_FILE="$MEMORY_PATH/USER.md"
MEMORY_FILE="$MEMORY_PATH/MEMORY.md"
DREAM_FILE="$MEMORY_PATH/.last-dream"
SESSION_FILE="$MEMORY_PATH/.session-count"

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

# Build context string
context=""
for label_file in "Soul:$SOUL_FILE" "Agent:$AGENT_FILE" "User:$USER_FILE" "Memory:$MEMORY_FILE"; do
  label="${label_file%%:*}"
  file="${label_file#*:}"
  if [ -f "$file" ]; then
    context+="=== ${label} Context ===\n"
    context+="$(head -200 "$file")\n"
    context+="=== End ${label} Context ===\n\n"
  fi
done

# Append staleness warning if needed
if [ -f "$DREAM_FILE" ]; then
  raw_dream=$(cat "$DREAM_FILE" 2>/dev/null || echo "")
  # Validate numeric content before arithmetic use
  if echo "$raw_dream" | grep -qE '^[0-9]+$'; then
    last_dream=$raw_dream
    now=$(date +%s)
    age=$(( (now - last_dream) / 86400 ))
    if [ "$age" -ge 3 ] && [ "$count" -ge 5 ]; then
      context+="⚠ Memory hasn't been consolidated in ${age} days (${count} sessions). Consider running 'consolidate memory'.\n"
    fi
  fi
else
  if [ "$count" -ge 5 ]; then
    context+="⚠ Memory has never been consolidated (${count} sessions so far). Consider running 'consolidate memory'.\n"
  fi
fi

# Output as additionalContext JSON for Claude Code
printf '%s' "$context" | python3 -c "
import json, sys
content = sys.stdin.read()
print(json.dumps({
  'hookSpecificOutput': {
    'hookEventName': 'SessionStart',
    'additionalContext': content
  }
}))
"
