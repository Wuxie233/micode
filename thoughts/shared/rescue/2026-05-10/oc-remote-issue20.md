# oc-remote issue-20 snapshot

**Worktree:** /root/CODE/issue-20-correct-mcp-fallback-behavior-and-perform-a-stan
**Branch:** issue/20-correct-mcp-fallback-behavior-and-perform-a-stan
**Captured:** 2026-05-10
**Snapshot status:** captured
**Lifecycle issue state:** closed (from `gh issue view 20`)

## Branch state

Command group:

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git status --porcelain=v1 --branch
git log --oneline -20
git rev-parse HEAD
git rev-parse @{u} 2>/dev/null || echo "(no upstream)"
```

Output:

```text
issue/20-correct-mcp-fallback-behavior-and-perform-a-stan

## issue/20-correct-mcp-fallback-behavior-and-perform-a-stan...origin/issue/20-correct-mcp-fallback-behavior-and-perform-a-stan [ahead 21, behind 21]
40a1f4a chore(release): mcp runtime status parity correction v1.6.26 (#20)
013b37f chore(plan): add runtime MCP status release plan (#20)
a168341 chore(design): document runtime MCP status correction (#20)
9bd32c7 chore(release): ship MCP fallback fix and UX corrective release prep (#20)
01f3f84 chore(plan): add MCP fallback global UX release plan (#20)
d56417e chore(design): document MCP fallback and global UX audit design (#20)
1c4dc5a fix(release): restore v1.6.24 APK signing
d1b66e5 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
1ee58f2 chore(release): add signed v1.6.24 artifact
c047c3e chore(app): implement MCP parity UX release (#19)
aecc6b7 chore(plan): add MCP parity UX and release implementation plan (#19)
9d9970a chore(design): document MCP parity and UX release design (#19)
bfca1eb chore(release): prepare v1.6.23
8ecf49b fix(chat): preserve session context and retry abort
145337c docs(design): preserve project context when forking sessions
ec4f32d chore(release): prepare v1.6.22
cb9be61 fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
890830c feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
fae3702 docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
a89a7cb fix: require signed release APK publishing
40a1f4a137c51a187b96cc32737621b4a77e39f0
441192dccf627b6dde9d273ee1d2a8215e7335b7
```

**Has uncommitted changes:** no
**Upstream:** `origin/issue/20-correct-mcp-fallback-behavior-and-perform-a-stan` at `441192dccf627b6dde9d273ee1d2a8215e7335b7`
**Ahead of upstream branch:** yes (21)
**Behind upstream branch:** yes (21)

## Default-branch comparison

Command group:

```bash
git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | tee /tmp/issue20-ahead.txt
echo "ahead-count: $(wc -l < /tmp/issue20-ahead.txt)"
git log --oneline HEAD..origin/$DEFAULT | head -10
```

Output:

```text
default-branch: master
40a1f4a chore(release): mcp runtime status parity correction v1.6.26 (#20)
013b37f chore(plan): add runtime MCP status release plan (#20)
a168341 chore(design): document runtime MCP status correction (#20)
9bd32c7 chore(release): ship MCP fallback fix and UX corrective release prep (#20)
01f3f84 chore(plan): add MCP fallback global UX release plan (#20)
d56417e chore(design): document MCP fallback and global UX audit design (#20)
1c4dc5a fix(release): restore v1.6.24 APK signing
d1b66e5 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
1ee58f2 chore(release): add signed v1.6.24 artifact
c047c3e chore(app): implement MCP parity UX release (#19)
aecc6b7 chore(plan): add MCP parity UX and release implementation plan (#19)
9d9970a chore(design): document MCP parity and UX release design (#19)
bfca1eb chore(release): prepare v1.6.23
8ecf49b fix(chat): preserve session context and retry abort
145337c docs(design): preserve project context when forking sessions
ec4f32d chore(release): prepare v1.6.22
cb9be61 fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
890830c feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
fae3702 docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
a89a7cb fix: require signed release APK publishing
ec27684 fix: finalize v1.6.20 issue closure
ahead-count: 21
3c990ee chore(cleanup): remove accidental opencode state artifact
255b5c8 chore(chat): Chat status visibility ordering fixes (#22)
dd0c3a6 chore(plan): add chat status visibility and ordering implementation plan (#22)
1873240 chore(design): document chat status visibility fixes (#22)
69adc3d docs(release): record v1.6.25 artifact verification
1e8b0d9 Merge issue #20 corrective release prep
2e051ac chore(release): ship MCP fallback fix and UX corrective release prep (#20)
32dcb4d chore(plan): add MCP fallback global UX release plan (#20)
044cdc6 chore(design): document MCP fallback and global UX audit design (#20)
89151e2 fix(release): restore v1.6.24 APK signing
```

**Default branch:** master
**Has unpushed/unmerged commits ahead of `origin/master`:** yes (21)
**Behind `origin/master`:** yes (24)

## Ahead list and per-commit subject-grep checks

Command group:

```bash
for sha in $(git log --format=%H origin/$DEFAULT..HEAD); do
  echo "--- $sha ---"
  git show --stat --format='%s%n%h' $sha | head -20
  SUBJ=$(git log -1 --format=%s $sha)
  echo "matches-in-default-by-subject:"
  git log --oneline origin/$DEFAULT --grep="$(echo "$SUBJ" | sed 's/[][\/.*^$]/\\&/g')" | head -5
done
```

Output:

```text
--- 40a1f4a137c51a187b96cc32737621b4a77e39f0 ---
chore(release): mcp runtime status parity correction v1.6.26 (#20)
40a1f4a

 RELEASE_NOTES_1.6.26.md                            |  31 +++
 app/build.gradle.kts                               |   4 +-
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  48 ++++
 .../ocremote/data/repository/McpConfigParser.kt    |  89 +++++--
 .../ocremote/data/repository/ServerRepository.kt   |  74 +++++-
 .../dev/minios/ocremote/domain/model/McpConfig.kt  |  32 ++-
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |  99 +++++---
 .../sessions/components/McpManagementSheet.kt      | 207 ++++++++++++++--
 .../ocremote/data/api/OpenCodeApiMcpStatusTest.kt  | 160 ++++++++++++
 .../McpConfigParserOfficialSchemaTest.kt           |  84 +++++++
 .../ServerRepositoryMcpRuntimeFirstTest.kt         | 275 +++++++++++++++++++++
 .../data/repository/ServerRepositoryTest.kt        |   5 +
 .../minios/ocremote/fixtures/McpFixtureLoadTest.kt |  19 ++
 .../sessions/McpViewModelRuntimeStateTest.kt       | 162 ++++++++++++
 .../mcp/runtime-status-seven-servers.json          |   9 +
 15 files changed, 1205 insertions(+), 93 deletions(-)
matches-in-default-by-subject:
--- 013b37f0daebdc1484e2c45290f316b66ff32e21 ---
chore(plan): add runtime MCP status release plan (#20)
013b37f

 .../plans/2026-04-30-mcp-runtime-status-release.md | 1969 ++++++++++++++++++++
 1 file changed, 1969 insertions(+)
matches-in-default-by-subject:
--- a168341ec33fb6197b98b6f2a2330d5b14488e6f ---
chore(design): document runtime MCP status correction (#20)
a168341

 ...6-04-30-mcp-runtime-status-correction-design.md | 126 +++++++++++++++++++++
 1 file changed, 126 insertions(+)
matches-in-default-by-subject:
--- 9bd32c7df024d7ace2271ab6d009505e5a7f5f58 ---
chore(release): ship MCP fallback fix and UX corrective release prep (#20)
9bd32c7

 RELEASE_NOTES_1.6.25.md                            |  27 ++++
 app/build.gradle.kts                               |   4 +-
 .../ocremote/data/repository/ServerRepository.kt   |  48 ++++--
 .../minios/ocremote/ui/components/StateCards.kt    |  12 +-
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  15 +-
 .../ocremote/ui/screens/home/HomeScreen.kt         |  66 +++++---
 .../ocremote/ui/screens/home/ServerDialog.kt       |  41 +++--
 .../ui/screens/server/ServerProvidersScreen.kt     |  59 +++++--
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |   7 +-
 .../sessions/components/McpManagementSheet.kt      |  52 +++++--
 .../sessions/components/ProjectGroupHeader.kt      |  10 ++
 .../ocremote/ui/screens/settings/SettingsScreen.kt |  43 ++++--
 .../data/repository/ServerRepositoryTest.kt        | 170 ++++++++++++++++++++-
 .../ocremote/ui/components/StateCardsTest.kt       |  36 +++++
 .../ui/screens/home/ServerFormAccessibilityTest.kt |  54 +++++++
 .../ui/screens/sessions/McpViewModelTest.kt        |   1 +
 .../components/ProjectGroupHeaderMcpHintTest.kt    |   9 ++
matches-in-default-by-subject:
2e051ac chore(release): ship MCP fallback fix and UX corrective release prep (#20)
--- 01f3f8404c9ff40a9027242631e2d23d914821d5 ---
chore(plan): add MCP fallback global UX release plan (#20)
01f3f84

 .../2026-04-29-mcp-fallback-global-ux-release.md   | 708 +++++++++++++++++++++
 1 file changed, 708 insertions(+)
matches-in-default-by-subject:
32dcb4d chore(plan): add MCP fallback global UX release plan (#20)
--- d56417e20a917a530ce39455c759359369f3fe2c ---
chore(design): document MCP fallback and global UX audit design (#20)
d56417e

 .../2026-04-29-mcp-fallback-global-ux-design.md    | 147 +++++++++++++++++++++
 1 file changed, 147 insertions(+)
matches-in-default-by-subject:
044cdc6 chore(design): document MCP fallback and global UX audit design (#20)
--- 1c4dc5ab040b02bec440f0ef86de5f7295f44bda ---
fix(release): restore v1.6.24 APK signing
1c4dc5a

 RELEASE_NOTES_1.6.24.md           |   4 ++--
 release-apks/oc-remote-1.6.24.apk | Bin 4720932 -> 4720932 bytes
 2 files changed, 2 insertions(+), 2 deletions(-)
matches-in-default-by-subject:
89151e2 fix(release): restore v1.6.24 APK signing
--- d1b66e5e3e6b7e38e3b719d2f679869968e0a8a6 ---
Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
d1b66e5

 RELEASE_NOTES_1.6.24.md                            |  34 ++
 app/build.gradle.kts                               |   4 +-
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  13 +-
 .../ocremote/data/repository/McpConfigParser.kt    |  25 +-
 .../ocremote/data/repository/ServerRepository.kt   |  10 +-
 .../minios/ocremote/ui/components/StateCards.kt    | 143 ++++++
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  58 ++-
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |  82 +++-
 .../ui/screens/sessions/SessionListScreen.kt       |   7 +
 .../sessions/components/McpManagementSheet.kt      | 182 ++++++--
 .../sessions/components/ProjectGroupHeader.kt      |  39 +-
 .../ocremote/data/api/OpenCodeApiMcpHeaderTest.kt  | 115 +++++
 .../data/repository/McpConfigParserTest.kt         |  47 ++
 .../data/repository/ServerRepositoryTest.kt        | 169 +++++++
 .../ocremote/ui/components/StateCardsTest.kt       |  45 ++
 .../ui/screens/chat/SlashCommandMergeTest.kt       |  66 +++
 .../ui/screens/sessions/McpViewModelTest.kt        | 208 ++++++++-
matches-in-default-by-subject:
6c353a2 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
--- 1ee58f2d68feb16170be87d7d7ffcb660fcf86f0 ---
chore(release): add signed v1.6.24 artifact
1ee58f2

 RELEASE_NOTES_1.6.24.md           |  12 ++++++------
 release-apks/oc-remote-1.6.24.apk | Bin 0 -> 4720932 bytes
 2 files changed, 6 insertions(+), 6 deletions(-)
matches-in-default-by-subject:
5ea366a chore(release): add signed v1.6.24 artifact
--- c047c3e91c3e94f51460ff4074ddfb8be9cbf326 ---
chore(app): implement MCP parity UX release (#19)
c047c3e

 RELEASE_NOTES_1.6.24.md                            |  34 ++++
 app/build.gradle.kts                               |   4 +-
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  13 +-
 .../ocremote/data/repository/McpConfigParser.kt    |  25 ++-
 .../ocremote/data/repository/ServerRepository.kt   |  10 +-
 .../minios/ocremote/ui/components/StateCards.kt    | 143 ++++++++++++++
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  58 +++++-
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |  82 ++++++--
 .../ui/screens/sessions/SessionListScreen.kt       |   7 +
 .../sessions/components/McpManagementSheet.kt      | 182 +++++++++----
matches-in-default-by-subject:
6522057 chore(app): implement MCP parity UX release (#19)
(remaining commits summarized in the table below; all command output was reviewed for each commit)
```

Patch-id cross-check command:

```bash
git cherry -v origin/master HEAD | head -80
```

Patch-id cross-check output:

```text
- ec27684538d8fd0e0127bdb2f3742c8aaa5a8f0f fix: finalize v1.6.20 issue closure
- a89a7cb87e15bf95ce2db97ae7eb8bb2f06879d6 fix: require signed release APK publishing
- fae3702f02c69b638451271e2bcfe45726527f90 docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
- 890830ce54c66645b10cbcca8c3631be8b8536f3 feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
- cb9be61544dc11362c73eaa505fef03f5c591592 fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
- ec4f32d4056b2068d830d4a5921be93f17a900f1 chore(release): prepare v1.6.22
- 145337caa63a184b465b7ae207eedaa87af23791 docs(design): preserve project context when forking sessions
- 8ecf49bf3dd9452d1c76ce1655bc3dd103c0f0ac fix(chat): preserve session context and retry abort
- bfca1eb9498325ca4136c0b69da3157245ef6f52 chore(release): prepare v1.6.23
- 9d9970a44571a585901ad55dddf8a29c91a2e294 chore(design): document MCP parity and UX release design (#19)
- aecc6b77692ccefe0506f1eb446694091eadac97 chore(plan): add MCP parity UX and release implementation plan (#19)
- c047c3e91c3e94f51460ff4074ddfb8be9cbf326 chore(app): implement MCP parity UX release (#19)
- 1ee58f2d68feb16170be87d7d7ffcb660fcf86f0 chore(release): add signed v1.6.24 artifact
- 1c4dc5ab040b02bec440f0ef86de5f7295f44bda fix(release): restore v1.6.24 APK signing
- d56417e20a917a530ce39455c759359369f3fe2c chore(design): document MCP fallback and global UX audit design (#20)
- 01f3f8404c9ff40a9027242631e2d23d914821d5 chore(plan): add MCP fallback global UX release plan (#20)
- 9bd32c7df024d7ace2271ab6d009505e5a7f5f58 chore(release): ship MCP fallback fix and UX corrective release prep (#20)
+ a168341ec33fb6197b98b6f2a2330d5b14488e6f chore(design): document runtime MCP status correction (#20)
+ 013b37f0daebdc1484e2c45290f316b66ff32e21 chore(plan): add runtime MCP status release plan (#20)
+ 40a1f4a137c51a187b96cc32737621b4a77e39f0 chore(release): mcp runtime status parity correction v1.6.26 (#20)
```

## Ownership preflight

Command group:

```bash
git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission
```

Output:

```text
origin	https://github.com/Wuxie233/oc-remote.git (fetch)
origin	https://github.com/Wuxie233/oc-remote.git (push)
original-upstream	https://github.com/crim50n/oc-remote.git (fetch)
original-upstream	https://github.com/crim50n/oc-remote.git (push)
{"isFork":true,"nameWithOwner":"Wuxie233/oc-remote","owner":{"id":"U_kgDOBz91cg","login":"Wuxie233"},"parent":{"id":"R_kgDORRHRew","name":"oc-remote","owner":{"id":"MDQ6VXNlcjE2NDAxMTk5","login":"crim50n"}},"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-fork
**Reasoning:** `origin` points to the user's fork `Wuxie233/oc-remote`, `isFork` is true, and the upstream parent is `crim50n/oc-remote`; any future Batch 3 remote mutation must target `origin` only.

## Lifecycle issue state

Command:

```bash
gh issue view 20 --json number,state,title,closedAt 2>/dev/null || echo "(issue 20 lookup failed)"
```

Output:

```json
{"closedAt":"2026-04-29T22:13:38Z","number":20,"state":"CLOSED","title":"Correct MCP fallback behavior and perform a standards-guided global UX audit/improvement pass"}
```

## PR status

Command:

```bash
gh pr list --head issue/20-correct-mcp-fallback-behavior-and-perform-a-stan --state all --json number,state,title,url
```

Output:

```json
[]
```

## Project type detection

Command:

```bash
ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Output:

```text
build.gradle.kts
```

**Detected project type:** Gradle/Kotlin (`build.gradle.kts` present)
**Likely Batch 3 verification command:** `./gradlew test` if wrapper exists; otherwise `gradle test`.

## Supersession analysis

For each unmerged feature commit, this table records whether the default branch already carries an equivalent change, using the required commit-subject grep and a patch-id cross-check (`git cherry -v`) to reduce ambiguity. A `+` patch-id means no equivalent patch-id was found in `origin/master`; a `-` patch-id means Git considers the patch equivalent to one already reachable from `origin/master`.

| SHA | Subject | Equivalent in default? | Notes |
|-----|---------|-----------------------|-------|
| 40a1f4a | chore(release): mcp runtime status parity correction v1.6.26 (#20) | no | No subject grep match in `origin/master`; `git cherry -v` marks `+`. |
| 013b37f | chore(plan): add runtime MCP status release plan (#20) | no | No subject grep match in `origin/master`; `git cherry -v` marks `+`. |
| a168341 | chore(design): document runtime MCP status correction (#20) | no | No subject grep match in `origin/master`; `git cherry -v` marks `+`. |
| 9bd32c7 | chore(release): ship MCP fallback fix and UX corrective release prep (#20) | yes | Subject grep match: `2e051ac`; `git cherry -v` marks `-`. |
| 01f3f84 | chore(plan): add MCP fallback global UX release plan (#20) | yes | Subject grep match: `32dcb4d`; `git cherry -v` marks `-`. |
| d56417e | chore(design): document MCP fallback and global UX audit design (#20) | yes | Subject grep match: `044cdc6`; `git cherry -v` marks `-`. |
| 1c4dc5a | fix(release): restore v1.6.24 APK signing | yes | Subject grep match: `89151e2`; `git cherry -v` marks `-`. |
| d1b66e5 | Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe' | yes | Subject grep match: `6c353a2`; merge commit has no `git cherry -v` sign in the linear patch-id output. |
| 1ee58f2 | chore(release): add signed v1.6.24 artifact | yes | Subject grep match: `5ea366a`; `git cherry -v` marks `-`. |
| c047c3e | chore(app): implement MCP parity UX release (#19) | yes | Subject grep match: `6522057`; `git cherry -v` marks `-`. |
| aecc6b7 | chore(plan): add MCP parity UX and release implementation plan (#19) | yes | Subject grep match: `efcd2ea`; `git cherry -v` marks `-`. |
| 9d9970a | chore(design): document MCP parity and UX release design (#19) | yes | Subject grep match: `aeba69c`; `git cherry -v` marks `-`. |
| bfca1eb | chore(release): prepare v1.6.23 | yes | Subject grep match: `e9472be`; `git cherry -v` marks `-`. |
| 8ecf49b | fix(chat): preserve session context and retry abort | yes | Subject grep match: `7786446`; `git cherry -v` marks `-`. |
| 145337c | docs(design): preserve project context when forking sessions | yes | Subject grep match: `d15ce7d`; `git cherry -v` marks `-`. |
| ec4f32d | chore(release): prepare v1.6.22 | yes | Subject grep match: `ba6f2c1`; `git cherry -v` marks `-`. |
| cb9be61 | fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi | yes | Subject grep match: `2c50719`; `git cherry -v` marks `-`. |
| 890830c | feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list | yes | Subject grep match: `cffe65a`; `git cherry -v` marks `-`. |
| fae3702 | docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list | yes | Subject grep match: `a62142d`; `git cherry -v` marks `-`. |
| a89a7cb | fix: require signed release APK publishing | yes | Subject grep match: `4158c78`; `git cherry -v` marks `-`. |
| ec27684 | fix: finalize v1.6.20 issue closure | yes | Subject grep match: `66d3138`; `git cherry -v` marks `-`. |

**Supersession verdict:** partially-superseded
**Recommended Batch 3 action:** cherry-pick remaining commits

Rationale: 18 linear commits plus one merge commit are equivalent to commits already in `origin/master`, but three runtime MCP status commits (`a168341`, `013b37f`, `40a1f4a`) have no subject-grep match and are marked `+` by `git cherry -v`. This is stronger than subject grep alone, but Batch 3 should still cherry-pick only those three non-superseded commits into a fresh branch off current `origin/master` and leave the resulting PR for human review per the plan.

## Batch 3 ownership preflight reconfirmation

Reconfirmed immediately before the Batch 3 `git push origin rescue/issue-20-recovered-20260510` and `gh pr create` remote mutations.

Command group:

```bash
git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission
```

Output:

```text
origin	https://github.com/Wuxie233/oc-remote.git (fetch)
origin	https://github.com/Wuxie233/oc-remote.git (push)
original-upstream	https://github.com/crim50n/oc-remote.git (fetch)
original-upstream	https://github.com/crim50n/oc-remote.git (push)
{"isFork":true,"nameWithOwner":"Wuxie233/oc-remote","owner":{"id":"U_kgDOBz91cg","login":"Wuxie233"},"parent":{"id":"R_kgDORRHRew","name":"oc-remote","owner":{"id":"MDQ6VXNlcjE2NDAxMTk5","login":"crim50n"}},"viewerPermission":"ADMIN"}
```

**Ownership classification (Batch 3):** safe-origin-fork
**Reasoning:** `origin` still points to the user's fork `Wuxie233/oc-remote`; remote mutations in Batch 3 used `origin` only and did not touch `original-upstream`.

## Batch 3 cherry-pick and PR evidence

Commands:

```bash
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
git checkout -b rescue/issue-20-recovered-20260510 origin/master
git cherry-pick a168341ec33fb6197b98b6f2a2330d5b14488e6f
git cherry-pick 013b37f0daebdc1484e2c45290f316b66ff32e21
git cherry-pick 40a1f4a137c51a187b96cc32737621b4a77e39f0
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 git push origin rescue/issue-20-recovered-20260510
gh pr create --base "$DEFAULT" --head rescue/issue-20-recovered-20260510 --title "Recover non-superseded commits from issue-20" --body "Cherry-picks commits from issue/20 branch that are not yet in $DEFAULT. Defer merge to human review. Part of micode#62 rescue."
```

Cherry-pick output:

```text
Switched to a new branch 'rescue/issue-20-recovered-20260510'
Branch 'rescue/issue-20-recovered-20260510' set up to track remote branch 'master' from 'origin'.
[rescue/issue-20-recovered-20260510 3a3f349] chore(design): document runtime MCP status correction (#20)
 Author: root <root@S202602241837.tail010c6e.ts.net>
 Date: Thu Apr 30 11:08:12 2026 +0800
 1 file changed, 126 insertions(+)
 create mode 100644 thoughts/shared/designs/2026-04-30-mcp-runtime-status-correction-design.md
[rescue/issue-20-recovered-20260510 f14986d] chore(plan): add runtime MCP status release plan (#20)
 Author: root <root@S202602241837.tail010c6e.ts.net>
 Date: Thu Apr 30 11:23:02 2026 +0800
 1 file changed, 1969 insertions(+)
 create mode 100644 thoughts/shared/plans/2026-04-30-mcp-runtime-status-release.md
[rescue/issue-20-recovered-20260510 29c7427] chore(release): mcp runtime status parity correction v1.6.26 (#20)
 Author: root <root@S202602241837.tail010c6e.ts.net>
 Date: Thu Apr 30 14:05:38 2026 +0800
 15 files changed, 1205 insertions(+), 93 deletions(-)
 create mode 100644 RELEASE_NOTES_1.6.26.md
 create mode 100644 app/src/test/kotlin/dev/minios/ocremote/data/api/OpenCodeApiMcpStatusTest.kt
 create mode 100644 app/src/test/kotlin/dev/minios/ocremote/data/repository/McpConfigParserOfficialSchemaTest.kt
 create mode 100644 app/src/test/kotlin/dev/minios/ocremote/data/repository/ServerRepositoryMcpRuntimeFirstTest.kt
 create mode 100644 app/src/test/kotlin/dev/minios/ocremote/fixtures/McpFixtureLoadTest.kt
 create mode 100644 app/src/test/kotlin/dev/minios/ocremote/ui/screens/sessions/McpViewModelRuntimeStateTest.kt
 create mode 100644 app/src/test/resources/mcp/runtime-status-seven-servers.json
```

Push output:

```text
remote: 
remote: Create a pull request for 'rescue/issue-20-recovered-20260510' on GitHub by visiting:        
remote:      https://github.com/Wuxie233/oc-remote/pull/new/rescue/issue-20-recovered-20260510        
remote: 
To https://github.com/Wuxie233/oc-remote.git
 * [new branch]      rescue/issue-20-recovered-20260510 -> rescue/issue-20-recovered-20260510
```

PR creation output:

```text
https://github.com/Wuxie233/oc-remote/pull/23
```

## Advancement
**Branch path taken:** partially-superseded
**New rescue branch (if cherry-picked):** rescue/issue-20-recovered-20260510
**PR URL:** https://github.com/Wuxie233/oc-remote/pull/23
**Verification result:** not-run
**Final branch state:** open-rescue-pr
<!-- verify-compatible: Final branch state: open-rescue-pr -->

## Appendix: raw Task 1.4 per-commit subject-grep rerun

Command rerun from `/root/CODE/issue-20-correct-mcp-fallback-behavior-and-perform-a-stan` on 2026-05-10:

```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name); echo "default-branch: $DEFAULT"; git log --oneline origin/$DEFAULT..HEAD | tee /tmp/issue20-ahead-rerun.txt; echo "ahead-count: $(wc -l < /tmp/issue20-ahead-rerun.txt)"; for sha in $(git log --format=%H origin/$DEFAULT..HEAD); do echo "--- $sha ---"; git show --stat --format='%s%n%h' "$sha" | head -20; SUBJ=$(git log -1 --format=%s "$sha"); echo "matches-in-default-by-subject:"; git log --oneline origin/$DEFAULT --grep="$(echo "$SUBJ" | sed 's/[][\/.*^$]/\\&/g')" | head -5; done
```

Raw stdout/stderr:

```text
default-branch: master
40a1f4a chore(release): mcp runtime status parity correction v1.6.26 (#20)
013b37f chore(plan): add runtime MCP status release plan (#20)
a168341 chore(design): document runtime MCP status correction (#20)
9bd32c7 chore(release): ship MCP fallback fix and UX corrective release prep (#20)
01f3f84 chore(plan): add MCP fallback global UX release plan (#20)
d56417e chore(design): document MCP fallback and global UX audit design (#20)
1c4dc5a fix(release): restore v1.6.24 APK signing
d1b66e5 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
1ee58f2 chore(release): add signed v1.6.24 artifact
c047c3e chore(app): implement MCP parity UX release (#19)
aecc6b7 chore(plan): add MCP parity UX and release implementation plan (#19)
9d9970a chore(design): document MCP parity and UX release design (#19)
bfca1eb chore(release): prepare v1.6.23
8ecf49b fix(chat): preserve session context and retry abort
145337c docs(design): preserve project context when forking sessions
ec4f32d chore(release): prepare v1.6.22
cb9be61 fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
890830c feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
fae3702 docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
a89a7cb fix: require signed release APK publishing
ec27684 fix: finalize v1.6.20 issue closure
ahead-count: 21
--- 40a1f4a137c51a187b96cc32737621b4a77e39f0 ---
chore(release): mcp runtime status parity correction v1.6.26 (#20)
40a1f4a

 RELEASE_NOTES_1.6.26.md                            |  31 +++
 app/build.gradle.kts                               |   4 +-
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  48 ++++
 .../ocremote/data/repository/McpConfigParser.kt    |  89 +++++--
 .../ocremote/data/repository/ServerRepository.kt   |  74 +++++-
 .../dev/minios/ocremote/domain/model/McpConfig.kt  |  32 ++-
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |  99 +++++---
 .../sessions/components/McpManagementSheet.kt      | 207 ++++++++++++++--
 .../ocremote/data/api/OpenCodeApiMcpStatusTest.kt  | 160 ++++++++++++
 .../McpConfigParserOfficialSchemaTest.kt           |  84 +++++++
 .../ServerRepositoryMcpRuntimeFirstTest.kt         | 275 +++++++++++++++++++++
 .../data/repository/ServerRepositoryTest.kt        |   5 +
 .../minios/ocremote/fixtures/McpFixtureLoadTest.kt |  19 ++
 .../sessions/McpViewModelRuntimeStateTest.kt       | 162 ++++++++++++
 .../mcp/runtime-status-seven-servers.json          |   9 +
 15 files changed, 1205 insertions(+), 93 deletions(-)
matches-in-default-by-subject:
--- 013b37f0daebdc1484e2c45290f316b66ff32e21 ---
chore(plan): add runtime MCP status release plan (#20)
013b37f

 .../plans/2026-04-30-mcp-runtime-status-release.md | 1969 ++++++++++++++++++++
 1 file changed, 1969 insertions(+)
matches-in-default-by-subject:
--- a168341ec33fb6197b98b6f2a2330d5b14488e6f ---
chore(design): document runtime MCP status correction (#20)
a168341

 ...6-04-30-mcp-runtime-status-correction-design.md | 126 +++++++++++++++++++++
 1 file changed, 126 insertions(+)
matches-in-default-by-subject:
--- 9bd32c7df024d7ace2271ab6d009505e5a7f5f58 ---
chore(release): ship MCP fallback fix and UX corrective release prep (#20)
9bd32c7

 RELEASE_NOTES_1.6.25.md                            |  27 ++++
 app/build.gradle.kts                               |   4 +-
 .../ocremote/data/repository/ServerRepository.kt   |  48 ++++--
 .../minios/ocremote/ui/components/StateCards.kt    |  12 +-
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  15 +-
 .../ocremote/ui/screens/home/HomeScreen.kt         |  66 +++++---
 .../ocremote/ui/screens/home/ServerDialog.kt       |  41 +++--
 .../ui/screens/server/ServerProvidersScreen.kt     |  59 +++++--
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |   7 +-
 .../sessions/components/McpManagementSheet.kt      |  52 +++++--
 .../sessions/components/ProjectGroupHeader.kt      |  10 ++
 .../ocremote/ui/screens/settings/SettingsScreen.kt |  43 ++++--
 .../data/repository/ServerRepositoryTest.kt        | 170 ++++++++++++++++++++-
 .../ocremote/ui/components/StateCardsTest.kt       |  36 +++++
 .../ui/screens/home/ServerFormAccessibilityTest.kt |  54 +++++++
 .../ui/screens/sessions/McpViewModelTest.kt        |   1 +
 .../components/ProjectGroupHeaderMcpHintTest.kt    |   9 ++
matches-in-default-by-subject:
2e051ac chore(release): ship MCP fallback fix and UX corrective release prep (#20)
--- 01f3f8404c9ff40a9027242631e2d23d914821d5 ---
chore(plan): add MCP fallback global UX release plan (#20)
01f3f84

 .../2026-04-29-mcp-fallback-global-ux-release.md   | 708 +++++++++++++++++++++
 1 file changed, 708 insertions(+)
matches-in-default-by-subject:
32dcb4d chore(plan): add MCP fallback global UX release plan (#20)
--- d56417e20a917a530ce39455c759359369f3fe2c ---
chore(design): document MCP fallback and global UX audit design (#20)
d56417e

 .../2026-04-29-mcp-fallback-global-ux-design.md    | 147 +++++++++++++++++++++
 1 file changed, 147 insertions(+)
matches-in-default-by-subject:
044cdc6 chore(design): document MCP fallback and global UX audit design (#20)
--- 1c4dc5ab040b02bec440f0ef86de5f7295f44bda ---
fix(release): restore v1.6.24 APK signing
1c4dc5a

 RELEASE_NOTES_1.6.24.md           |   4 ++--
 release-apks/oc-remote-1.6.24.apk | Bin 4720932 -> 4720932 bytes
 2 files changed, 2 insertions(+), 2 deletions(-)
matches-in-default-by-subject:
89151e2 fix(release): restore v1.6.24 APK signing
--- d1b66e5e3e6b7e38e3b719d2f679869968e0a8a6 ---
Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
d1b66e5

 RELEASE_NOTES_1.6.24.md                            |  34 ++
 app/build.gradle.kts                               |   4 +-
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  13 +-
 .../ocremote/data/repository/McpConfigParser.kt    |  25 +-
 .../ocremote/data/repository/ServerRepository.kt   |  10 +-
 .../minios/ocremote/ui/components/StateCards.kt    | 143 ++++++
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  58 ++-
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |  82 +++-
 .../ui/screens/sessions/SessionListScreen.kt       |   7 +
 .../sessions/components/McpManagementSheet.kt      | 182 ++++++--
 .../sessions/components/ProjectGroupHeader.kt      |  39 +-
 .../ocremote/data/api/OpenCodeApiMcpHeaderTest.kt  | 115 +++++
 .../data/repository/McpConfigParserTest.kt         |  47 ++
 .../data/repository/ServerRepositoryTest.kt        | 169 +++++++
 .../ocremote/ui/components/StateCardsTest.kt       |  45 ++
 .../ui/screens/chat/SlashCommandMergeTest.kt       |  66 +++
 .../ui/screens/sessions/McpViewModelTest.kt        | 208 ++++++++-
matches-in-default-by-subject:
6c353a2 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
--- 1ee58f2d68feb16170be87d7d7ffcb660fcf86f0 ---
chore(release): add signed v1.6.24 artifact
1ee58f2

 RELEASE_NOTES_1.6.24.md           |  12 ++++++------
 release-apks/oc-remote-1.6.24.apk | Bin 0 -> 4720932 bytes
 2 files changed, 6 insertions(+), 6 deletions(-)
matches-in-default-by-subject:
5ea366a chore(release): add signed v1.6.24 artifact
--- c047c3e91c3e94f51460ff4074ddfb8be9cbf326 ---
chore(app): implement MCP parity UX release (#19)
c047c3e

 RELEASE_NOTES_1.6.24.md                            |  34 ++++
 app/build.gradle.kts                               |   4 +-
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  13 +-
 .../ocremote/data/repository/McpConfigParser.kt    |  25 ++-
 .../ocremote/data/repository/ServerRepository.kt   |  10 +-
 .../minios/ocremote/ui/components/StateCards.kt    | 143 ++++++++++++++
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  58 +++++-
 .../ocremote/ui/screens/sessions/McpViewModel.kt   |  82 ++++++--
 .../ui/screens/sessions/SessionListScreen.kt       |   7 +
 .../sessions/components/McpManagementSheet.kt      | 182 +++++++++++++-----
 .../sessions/components/ProjectGroupHeader.kt      |  39 +++-
 .../ocremote/data/api/OpenCodeApiMcpHeaderTest.kt  | 115 ++++++++++++
 .../data/repository/McpConfigParserTest.kt         |  47 +++++
 .../data/repository/ServerRepositoryTest.kt        | 169 +++++++++++++++++
 .../ocremote/ui/components/StateCardsTest.kt       |  45 +++++
 .../ui/screens/chat/SlashCommandMergeTest.kt       |  66 +++++++
 .../ui/screens/sessions/McpViewModelTest.kt        | 208 ++++++++++++++++++++-
matches-in-default-by-subject:
6522057 chore(app): implement MCP parity UX release (#19)
--- aecc6b77692ccefe0506f1eb446694091eadac97 ---
chore(plan): add MCP parity UX and release implementation plan (#19)
aecc6b7

 .../plans/2026-04-29-mcp-parity-ux-release.md      | 511 +++++++++++++++++++++
 1 file changed, 511 insertions(+)
matches-in-default-by-subject:
efcd2ea chore(plan): add MCP parity UX and release implementation plan (#19)
--- 9d9970a44571a585901ad55dddf8a29c91a2e294 ---
chore(design): document MCP parity and UX release design (#19)
9d9970a

 .../2026-04-29-mcp-parity-ux-release-design.md     | 162 +++++++++++++++++++++
 1 file changed, 162 insertions(+)
matches-in-default-by-subject:
aeba69c chore(design): document MCP parity and UX release design (#19)
--- bfca1eb9498325ca4136c0b69da3157245ef6f52 ---
chore(release): prepare v1.6.23
bfca1eb

 RELEASE_NOTES_1.6.23.md                    | 23 +++++++++++++++++++++++
 app/build.gradle.kts                       |  4 ++--
 app/src/main/res/values-ar/strings.xml     |  1 +
 app/src/main/res/values-de/strings.xml     |  1 +
 app/src/main/res/values-es/strings.xml     |  1 +
 app/src/main/res/values-fr/strings.xml     |  1 +
 app/src/main/res/values-id/strings.xml     |  1 +
 app/src/main/res/values-it/strings.xml     |  1 +
 app/src/main/res/values-ja/strings.xml     |  1 +
 app/src/main/res/values-ko/strings.xml     |  1 +
 app/src/main/res/values-pl/strings.xml     |  1 +
 app/src/main/res/values-pt-rBR/strings.xml |  1 +
 app/src/main/res/values-ru/strings.xml     |  1 +
 app/src/main/res/values-tr/strings.xml     |  1 +
 app/src/main/res/values-uk/strings.xml     |  1 +
 app/src/main/res/values-zh-rCN/strings.xml |  1 +
 16 files changed, 39 insertions(+), 2 deletions(-)
matches-in-default-by-subject:
e9472be chore(release): prepare v1.6.23
--- 8ecf49bf3dd9452d1c76ce1655bc3dd103c0f0ac ---
fix(chat): preserve session context and retry abort
8ecf49b

 app/build.gradle.kts                               |   1 +
 .../dev/minios/ocremote/data/api/OpenCodeApi.kt    |  13 +-
 .../minios/ocremote/domain/model/SessionStatus.kt  |  21 +-
 .../ui/screens/chat/ChatAbortResultHandler.kt      |  28 +
 .../minios/ocremote/ui/screens/chat/ChatScreen.kt  |  24 +-
 .../ocremote/ui/screens/chat/ChatViewModel.kt      |  59 +-
 .../ui/screens/chat/ForkDirectoryResolver.kt       |  38 ++
 app/src/main/res/values/strings.xml                |   1 +
 app/src/test/kotlin/android/net/Uri.kt             |  50 ++
 .../ocremote/data/api/OpenCodeApiForkTest.kt       | 120 ++++
 .../domain/model/SessionStatusInterruptibleTest.kt |  24 +
 .../ui/screens/chat/ChatAbortResultHandlerTest.kt  |  70 +++
 .../ui/screens/chat/ForkDirectoryResolverTest.kt   |  85 +++
 .../2026-04-28-retry-interrupt-control-design.md   | 141 +++++
 .../2026-04-28-fork-session-project-context.md     | 636 +++++++++++++++++++++
 .../plans/2026-04-28-retry-interrupt-control.md    | 581 +++++++++++++++++++
 16 files changed, 1876 insertions(+), 16 deletions(-)
matches-in-default-by-subject:
7786446 fix(chat): preserve session context and retry abort
--- 145337caa63a184b465b7ae207eedaa87af23791 ---
docs(design): preserve project context when forking sessions
145337c

 ...26-04-28-fork-session-project-context-design.md | 133 +++++++++++++++++++++
 1 file changed, 133 insertions(+)
matches-in-default-by-subject:
d15ce7d docs(design): preserve project context when forking sessions
--- ec4f32d4056b2068d830d4a5921be93f17a900f1 ---
chore(release): prepare v1.6.22
ec4f32d

 RELEASE_NOTES_1.6.22.md | 30 ++++++++++++++++++++++++++++++
 app/build.gradle.kts    |  4 ++--
 2 files changed, 32 insertions(+), 2 deletions(-)
matches-in-default-by-subject:
ba6f2c1 chore(release): prepare v1.6.22
--- cb9be61544dc11362c73eaa505fef03f5c591592 ---
fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
cb9be61

 .../kotlin/dev/minios/ocremote/MainActivity.kt     |   5 +
 app/src/main/res/values-ar/strings.xml             |  74 ++
 app/src/main/res/values-de/strings.xml             |  74 ++
 app/src/main/res/values-es/strings.xml             |  74 ++
 app/src/main/res/values-fr/strings.xml             | 890 ++++++++++---------
 app/src/main/res/values-id/strings.xml             |  74 ++
 app/src/main/res/values-it/strings.xml             |  74 ++
 app/src/main/res/values-ja/strings.xml             |  74 ++
 app/src/main/res/values-ko/strings.xml             |  74 ++
 app/src/main/res/values-pl/strings.xml             |  74 ++
 app/src/main/res/values-pt-rBR/strings.xml         |  74 ++
 app/src/main/res/values-ru/strings.xml             |  74 ++
 app/src/main/res/values-tr/strings.xml             |  74 ++
 app/src/main/res/values-uk/strings.xml             |  74 ++
 app/src/main/res/values-zh-rCN/strings.xml         |   5 +
 lokit.lock                                         | 969 ++++++++++++++++++++-
 16 files changed, 2353 insertions(+), 404 deletions(-)
matches-in-default-by-subject:
2c50719 fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
--- 890830ce54c66645b10cbcca8c3631be8b8536f3 ---
feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
890830c

 .../data/preferences/SessionListPreferences.kt     |   15 +
 .../SessionListPreferencesRepository.kt            |   61 +-
 .../ui/screens/sessions/SessionListScreen.kt       |  136 +-
 .../ui/screens/sessions/SessionListViewModel.kt    |   68 +-
 .../ocremote/ui/screens/sessions/UndoAction.kt     |   26 +
 .../sessions/components/SessionListTopControls.kt  |   57 +-
 .../components/SessionScopeSegmentedControl.kt     |   85 +
 app/src/main/res/values-zh-rCN/strings.xml         |   13 +
 app/src/main/res/values/strings.xml                |   13 +
 .../SessionListPreferencesRepositoryTest.kt        |   42 +
 .../screens/sessions/SessionListViewModelTest.kt   |   44 +-
 .../ui/screens/sessions/SessionRowSwipeTest.kt     |   36 +
 .../shared/plans/2026-04-27-swipe-to-archive.md    | 1669 ++++++++++++++++++++
 13 files changed, 2204 insertions(+), 61 deletions(-)
matches-in-default-by-subject:
cffe65a feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
--- fae3702f02c69b638451271e2bcfe45726527f90 ---
docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
fae3702

 .../designs/2026-04-27-swipe-to-archive-design.md  | 262 +++++++++++++++++++++
 1 file changed, 262 insertions(+)
matches-in-default-by-subject:
a62142d docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
--- a89a7cb87e15bf95ce2db97ae7eb8bb2f06879d6 ---
fix: require signed release APK publishing
a89a7cb

 .github/workflows/release.yml | 37 +++++++++++++++++++++++++++----------
 RELEASE_NOTES_1.6.21.md       | 19 +++++++++++++++++++
 app/build.gradle.kts          |  4 ++--
 3 files changed, 48 insertions(+), 12 deletions(-)
matches-in-default-by-subject:
4158c78 fix: require signed release APK publishing
--- ec27684538d8fd0e0127bdb2f3742c8aaa5a8f0f ---
fix: finalize v1.6.20 issue closure
ec27684

 RELEASE_NOTES_1.6.20.md                               | 19 +++++++++++++++++++
 app/build.gradle.kts                                  |  4 ++--
 .../minios/ocremote/data/repository/EventReducer.kt   |  4 ++--
 .../data/repository/EventReducerActiveSessionTest.kt  |  5 +++--
 4 files changed, 26 insertions(+), 6 deletions(-)
matches-in-default-by-subject:
66d3138 fix: finalize v1.6.20 issue closure
```
