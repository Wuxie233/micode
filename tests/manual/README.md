# Manual Testing Guide

This directory contains fixtures and instructions for manually testing the continuous-claude-integration features.

## Quick Start

```bash
# From your target project directory:
bash /path/to/tests/manual/setup.sh

# Or copy fixtures manually:
cp -r tests/manual/fixtures/thoughts ./
```

## Features to Test

### 1. Ledger Injection (automatic)

**What it does:** Injects the most recent ledger into the system prompt when starting a session.

**Test:**
1. Ensure `thoughts/ledgers/CONTINUITY_test-session.md` exists
2. Start opencode
3. Ask: "What task am I currently working on?"
4. Assistant should reference "token refresh logic" from the ledger

**Expected:** Assistant knows about the OAuth implementation context without you explaining it.

---

### 2. Ledger Creation (`/ledger` command)

**What it does:** Creates or updates a continuity ledger with current session state.

**Test:**
1. Start a conversation about a coding task
2. Run: `/ledger`
3. Check `thoughts/ledgers/` for new/updated file

**Expected:** A CONTINUITY_*.md file with Goal, State, Working Set sections.

---

### 3. Artifact Search (`/search` command)

**What it does:** Searches past handoffs, plans, and ledgers using full-text search.

**Test searches:**
```
/search oauth authentication
/search JWT tokens
/search passport.js
/search database migration  (should return no results)
```

**Expected:** Returns ranked results with file paths and relevance scores.

---

### 4. Auto-Clear-Ledger (at 80% context)

**What it does:** When context reaches 80%, automatically:
1. Updates the ledger
2. Creates a handoff document
3. Clears the session
4. Injects the ledger into the fresh session

**Test (requires lowering threshold):**

1. Edit `src/hooks/auto-clear-ledger.ts`:
   ```typescript
   // Change from:
   export const DEFAULT_THRESHOLD = 0.80;
   // To:
   export const DEFAULT_THRESHOLD = 0.10;  // 10% for testing
   ```

2. Rebuild: `bun run build`

3. Have a conversation until toast appears

**Expected:**
- Toast: "Context Window: XX% used - saving ledger and clearing..."
- New/updated ledger in `thoughts/ledgers/`
- New handoff in `thoughts/shared/handoffs/`
- Toast: "Context Cleared: Ledger + handoff saved..."
- Session continues with ledger context

**Remember to revert the threshold after testing!**

---

### 5. Environment-Gated MCP Servers

**What it does:** Adds Perplexity/Firecrawl MCP servers when API keys are set.

**Test Perplexity:**
```bash
export PERPLEXITY_API_KEY=your-key-here
opencode
# Ask: "Search the web for latest TypeScript 5.4 features"
```

**Test Firecrawl:**
```bash
export FIRECRAWL_API_KEY=your-key-here
opencode
# Ask: "Crawl and summarize https://example.com"
```

**Expected:** Web search/crawl tools available when keys are set.

---

## Test Fixtures

| File | Purpose |
|------|---------|
| `thoughts/ledgers/CONTINUITY_test-session.md` | Sample ledger for injection testing |
| `thoughts/shared/handoffs/2024-12-28_15-30-00_oauth-setup.md` | Sample handoff for search testing |
| `thoughts/shared/plans/2024-12-27-oauth-implementation.md` | Sample plan for search testing |

## Cleanup

```bash
# Remove test fixtures
rm -rf thoughts/ledgers/CONTINUITY_test-session.md
rm -rf thoughts/shared/handoffs/2024-12-28_15-30-00_oauth-setup.md
rm -rf thoughts/shared/plans/2024-12-27-oauth-implementation.md

# Remove artifact index database (if testing search)
rm -rf ~/.config/opencode/artifact-index/context.db
```

## Troubleshooting

### Ledger not injected
- Check `thoughts/ledgers/` has a `CONTINUITY_*.md` file
- File must start with `CONTINUITY_` prefix
- Check file permissions

### Search returns no results
- Artifacts must be indexed first (happens on first search or via indexing)
- Check `~/.config/opencode/artifact-index/context.db` exists
- Try broader search terms

### Auto-clear not triggering
- Default threshold is 80% (~160K tokens)
- Check token usage in opencode status bar
- Temporarily lower threshold for testing

### MCP servers not available
- Verify API key is set: `echo $PERPLEXITY_API_KEY`
- Restart opencode after setting env var
- Check opencode logs for MCP connection errors
