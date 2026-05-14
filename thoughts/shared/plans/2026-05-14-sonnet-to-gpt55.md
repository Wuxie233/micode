---
date: 2026-05-14
topic: "Swap sonnet-4-6 routes to gpt-5.5 in micode.jsonc"
contract: none
---

# Sonnet→GPT-5.5 Route Swap Implementation Plan

**Goal:** Replace every route in `/root/.config/opencode/micode.jsonc` that points to `wuxie-claude/claude-sonnet-4-6` with `wuxie-openai/gpt-5.5`, leaving all other routes untouched.

**Architecture:** Single in-place edit on a user-level runtime config. A timestamped `.bak.<ts>.sonnet-to-gpt55` snapshot is taken first so the change is trivially revertable. No OpenCode restart, no service touch, no secret echoing.

**Design:** N/A (operational config edit, no design doc needed)

**Contract:** none

---

## Dependency Graph

```
Batch 1 (parallel): 1.1 [single-task plan, no deps]
```

---

## Batch 1: Config Edit (serial - 1 implementer)

Tasks: 1.1

### Task 1.1: Swap sonnet-4-6 routes to gpt-5.5 in micode.jsonc
**File:** `/root/.config/opencode/micode.jsonc`
**Test:** none (runtime config edit; risk is contained by pre-edit backup + post-edit JSONC validation, not by a unit test)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

```bash
# COMPLETE implementation - copy-paste ready

set -euo pipefail

CONFIG="/root/.config/opencode/micode.jsonc"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="${CONFIG}.bak.${TS}.sonnet-to-gpt55"

# 1) Pre-flight: file must exist and be non-empty
test -s "$CONFIG" || { echo "config missing or empty: $CONFIG" >&2; exit 1; }

# 2) Count current matches so we can verify the swap actually happened
BEFORE_COUNT="$(grep -c 'wuxie-claude/claude-sonnet-4-6' "$CONFIG" || true)"
echo "matches before: ${BEFORE_COUNT}"
if [ "$BEFORE_COUNT" -eq 0 ]; then
  echo "no routes reference wuxie-claude/claude-sonnet-4-6; nothing to do" >&2
  exit 0
fi

# 3) Timestamped backup with required suffix
cp -p "$CONFIG" "$BACKUP"
test -s "$BACKUP" || { echo "backup failed: $BACKUP" >&2; exit 1; }
echo "backup written: $BACKUP"

# 4) In-place swap. Literal string replace (not regex) so we don't accidentally
#    touch other model IDs that share substrings. Write to a temp file and
#    atomically move into place so a mid-edit crash can't truncate the config.
TMP="$(mktemp "${CONFIG}.tmp.XXXXXX")"
# Use python for safe literal global replace; sed delimiter choice is brittle
# when the replacement contains '/'.
python3 - "$CONFIG" "$TMP" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, "r", encoding="utf-8") as f:
    data = f.read()
old = "wuxie-claude/claude-sonnet-4-6"
new = "wuxie-openai/gpt-5.5"
out = data.replace(old, new)
with open(dst, "w", encoding="utf-8") as f:
    f.write(out)
PY
mv "$TMP" "$CONFIG"

# 5) Verify swap landed and old token is gone
AFTER_OLD="$(grep -c 'wuxie-claude/claude-sonnet-4-6' "$CONFIG" || true)"
AFTER_NEW="$(grep -c 'wuxie-openai/gpt-5.5' "$CONFIG" || true)"
echo "matches after (old): ${AFTER_OLD}"
echo "matches after (new): ${AFTER_NEW}"
if [ "$AFTER_OLD" -ne 0 ]; then
  echo "swap incomplete: old token still present" >&2
  cp -p "$BACKUP" "$CONFIG"
  echo "rolled back from backup" >&2
  exit 1
fi
if [ "$AFTER_NEW" -lt "$BEFORE_COUNT" ]; then
  echo "swap dropped occurrences: before=${BEFORE_COUNT} new=${AFTER_NEW}" >&2
  cp -p "$BACKUP" "$CONFIG"
  echo "rolled back from backup" >&2
  exit 1
fi

# 6) JSONC validation. JSONC = JSON with // and /* */ comments and trailing
#    commas tolerated. Strip those, then json.loads. Fail-and-rollback on parse
#    error so we never leave a broken runtime config in place.
python3 - "$CONFIG" "$BACKUP" <<'PY'
import json, re, shutil, sys
path, backup = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    raw = f.read()
# strip /* ... */ block comments
stripped = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
# strip // line comments (naive but adequate for config files; does not
# attempt to respect strings containing //)
stripped = re.sub(r"(^|[^:])//[^\n]*", r"\1", stripped)
# strip trailing commas before } or ]
stripped = re.sub(r",(\s*[}\]])", r"\1", stripped)
try:
    json.loads(stripped)
except Exception as e:
    shutil.copy2(backup, path)
    print(f"JSONC parse failed after edit: {e}", file=sys.stderr)
    print("rolled back from backup", file=sys.stderr)
    sys.exit(1)
print("JSONC validation: ok")
PY

echo "done. do NOT restart OpenCode; user will reload at their convenience."
```

**Verify:**
```bash
# Old token must be absent, new token must be present, file must still parse as JSONC.
! grep -q 'wuxie-claude/claude-sonnet-4-6' /root/.config/opencode/micode.jsonc \
  && grep -q 'wuxie-openai/gpt-5.5' /root/.config/opencode/micode.jsonc \
  && ls -1 /root/.config/opencode/micode.jsonc.bak.*.sonnet-to-gpt55 | tail -n1
```

**Commit:** none (user-level runtime config outside the repo; not a git-tracked path)

**Notes for implementer:**
- Do NOT print the contents of `micode.jsonc` or the backup file to chat output; the file may contain provider credentials. Echo only counts and file paths.
- Do NOT call any restart command (`systemctl restart opencode-web.service`, `/usr/local/bin/restart-opencode-detached`, `opencode web`, `opencode serve`). The user reloads on their own schedule.
- If `BEFORE_COUNT` is 0 the script exits cleanly with no backup written — there's nothing to swap, and creating a no-op backup would just pollute the directory.
- Rollback on any failure is automatic via `cp -p "$BACKUP" "$CONFIG"`; the backup is the recovery path.
