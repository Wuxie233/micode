# oc-remote issue-21 snapshot

**Worktree:** /root/CODE/issue-21-align-android-mcp-panel-with-opencode-web-runtim
**Branch:** issue/21-align-android-mcp-panel-with-opencode-web-runtim
**Captured:** 2026-05-10
**Snapshot status:** captured

## Branch state

Command bundle:

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -10
git rev-parse HEAD
```

Output:

```text
issue/21-align-android-mcp-panel-with-opencode-web-runtim
c3f4260 docs(release): record 1.6.27 APK SHA-256 and confirm signer parity
5d383dc chore(app): MCP runtime toggle parity release (#21)
305a6a1 chore(plan): add MCP runtime toggle parity release plan (#21)
1dcad53 chore(design): document MCP runtime toggle parity design (#21)
1c4dc5a fix(release): restore v1.6.24 APK signing
d1b66e5 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
1ee58f2 chore(release): add signed v1.6.24 artifact
c047c3e chore(app): implement MCP parity UX release (#19)
aecc6b7 chore(plan): add MCP parity UX and release implementation plan (#19)
9d9970a chore(design): document MCP parity and UX release design (#19)
c3f426057125a281df9de57c6613a2780972beea
```

`git status --porcelain` produced no output.

## Default-branch comparison

Command bundle:

```bash
git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10
```

Output:

```text
From https://github.com/Wuxie233/oc-remote
 + c3f4260...d281ef3 issue/21-align-android-mcp-panel-with-opencode-web-runtim -> origin/issue/21-align-android-mcp-panel-with-opencode-web-runtim  (forced update)
 + f544517...a5103b5 fix/v1.6.21-signed-release -> origin/fix/v1.6.21-signed-release  (forced update)
 + 1ee58f2...5ea366a issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe -> origin/issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe  (forced update)
 + 40a1f4a...441192d issue/20-correct-mcp-fallback-behavior-and-perform-a-stan -> origin/issue/20-correct-mcp-fallback-behavior-and-perform-a-stan  (forced update)
 + ec4f32d...ba6f2c1 work/issues-10-16-v1.6.20 -> origin/work/issues-10-16-v1.6.20  (forced update)
default-branch: master
c3f4260 docs(release): record 1.6.27 APK SHA-256 and confirm signer parity
5d383dc chore(app): MCP runtime toggle parity release (#21)
305a6a1 chore(plan): add MCP runtime toggle parity release plan (#21)
1dcad53 chore(design): document MCP runtime toggle parity design (#21)
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

## Ownership preflight

Command bundle:

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
**Reasoning:** `origin` points to Wuxie233/oc-remote, `gh repo view` reports `isFork: true` with parent crim50n/oc-remote, and the viewer has ADMIN permission on the origin fork; no writes to `original-upstream` are allowed.

## PR status

Command:

```bash
gh pr list --head issue/21-align-android-mcp-panel-with-opencode-web-runtim --state all --json number,state,title,url
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

## Dirty-work assessment

Additional command bundle:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "branch=$BRANCH"
echo "default=$DEFAULT"
echo "ahead-origin-branch-count: $(git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo unknown)"
echo "behind-origin-branch-count: $(git rev-list --count HEAD..origin/$BRANCH 2>/dev/null || echo unknown)"
echo "ahead-origin-default-count: $(git rev-list --count origin/$DEFAULT..HEAD 2>/dev/null || echo unknown)"
echo "behind-origin-default-count: $(git rev-list --count HEAD..origin/$DEFAULT 2>/dev/null || echo unknown)"
git status --porcelain
```

Output:

```text
branch=issue/21-align-android-mcp-panel-with-opencode-web-runtim
default=master
ahead-origin-branch-count: 19
behind-origin-branch-count: 19
ahead-origin-default-count: 19
behind-origin-default-count: 24
```

`git status --porcelain` produced no output.

Additional branch divergence logs:

```text
# git log --oneline origin/$(git rev-parse --abbrev-ref HEAD)..HEAD | head -50
c3f4260 docs(release): record 1.6.27 APK SHA-256 and confirm signer parity
5d383dc chore(app): MCP runtime toggle parity release (#21)
305a6a1 chore(plan): add MCP runtime toggle parity release plan (#21)
1dcad53 chore(design): document MCP runtime toggle parity design (#21)
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

# git log --oneline HEAD..origin/$(git rev-parse --abbrev-ref HEAD) | head -50
d281ef3 docs(release): record 1.6.27 APK SHA-256 and confirm signer parity
df70fbf chore(app): MCP runtime toggle parity release (#21)
0e8d859 chore(plan): add MCP runtime toggle parity release plan (#21)
f6b674c chore(design): document MCP runtime toggle parity design (#21)
89151e2 fix(release): restore v1.6.24 APK signing
6c353a2 Merge branch 'issue/19-fix-apk-mcp-visibility-parity-then-deliver-targe'
5ea366a chore(release): add signed v1.6.24 artifact
6522057 chore(app): implement MCP parity UX release (#19)
efcd2ea chore(plan): add MCP parity UX and release implementation plan (#19)
aeba69c chore(design): document MCP parity and UX release design (#19)
e9472be chore(release): prepare v1.6.23
7786446 fix(chat): preserve session context and retry abort
d15ce7d docs(design): preserve project context when forking sessions
ba6f2c1 chore(release): prepare v1.6.22
2c50719 fix(i18n,lint): regenerate French + fill missing locales via lokit; suppress dispatchKeyEvent RestrictedApi
cffe65a feat(sessions): swipe-to-archive + dual-scope (Inbox/Archived) list
a62142d docs(design): swipe-to-archive + dual-scope (Inbox/Archived) for session list
4158c78 fix: require signed release APK publishing
66d3138 fix: finalize v1.6.20 issue closure
```

**Has uncommitted changes:** no
**Has unpushed commits ahead of origin/issue/21-align-android-mcp-panel-with-opencode-web-runtim:** yes (19)
**Has unpushed commits ahead of origin/master:** yes (19)

## Advancement

**Action taken:** blocked-conflict
**PR URL:** https://github.com/Wuxie233/oc-remote/pull/24
**Verification command:** `./gradlew test`
**Verification result:** fail
**Final branch state:** blocked

### Gating fields read

- Ownership classification from snapshot: `safe-origin-fork`.
- Snapshot branch: `issue/21-align-android-mcp-panel-with-opencode-web-runtim`.
- Project type detection from snapshot: `build.gradle.kts`.

### Ownership preflight reconfirmed before remote mutation

Command:

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

**Ownership classification at advancement:** safe-origin-fork
**Reasoning:** `origin` is the writable Wuxie233 fork with ADMIN permission; `original-upstream` is crim50n/oc-remote and was not mutated.

### Branch sync / push attempt

Command:

```bash
git fetch origin
BRANCH=$(git rev-parse --abbrev-ref HEAD)
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "branch=$BRANCH"
echo "default=$DEFAULT"
echo "HEAD=$(git rev-parse HEAD)"
echo "origin_branch=$(git rev-parse origin/$BRANCH 2>/dev/null || echo missing)"
echo "ahead_origin_branch=$(git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo unknown)"
echo "behind_origin_branch=$(git rev-list --count HEAD..origin/$BRANCH 2>/dev/null || echo unknown)"
git push origin "$BRANCH"
```

Output:

```text
branch=issue/21-align-android-mcp-panel-with-opencode-web-runtim
default=master
HEAD=c3f426057125a281df9de57c6613a2780972beea
origin_branch=d281ef3ecba237e925f41f00f2c72d759443dc38
behind_origin_branch=19
To https://github.com/Wuxie233/oc-remote.git
 ! [rejected]        issue/21-align-android-mcp-panel-with-opencode-web-runtim -> issue/21-align-android-mcp-panel-with-opencode-web-runtim (non-fast-forward)
error: failed to push some refs to 'https://github.com/Wuxie233/oc-remote.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. Integrate the remote changes (e.g.
hint: 'git pull ...') before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.
```

Follow-up comparison showed the local and remote branch trees are identical, so no force-push or branch rewrite was attempted:

```text
head_tree=8ade2737cb5b442b0c1911401e63abe0e234645f
origin_branch_tree=8ade2737cb5b442b0c1911401e63abe0e234645f
```

### PR creation and mergeability

Existing PR check before creation:

```text
[]
```

Created PR:

```text
https://github.com/Wuxie233/oc-remote/pull/24
```

PR state after creation:

```json
{"baseRefName":"master","headRefName":"issue/21-align-android-mcp-panel-with-opencode-web-runtim","isDraft":false,"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING","number":24,"state":"OPEN","statusCheckRollup":null,"title":"Align Android MCP panel with OpenCode web runtime","url":"https://github.com/Wuxie233/oc-remote/pull/24"}
```

Changed files reported by PR #24:

```text
RELEASE_NOTES_1.6.27.md
app/build.gradle.kts
app/src/main/kotlin/dev/minios/ocremote/data/api/OpenCodeApi.kt
app/src/main/kotlin/dev/minios/ocremote/data/repository/ServerRepository.kt
app/src/main/kotlin/dev/minios/ocremote/domain/model/McpRuntime.kt
app/src/main/kotlin/dev/minios/ocremote/ui/screens/sessions/McpViewModel.kt
app/src/main/kotlin/dev/minios/ocremote/ui/screens/sessions/SessionListScreen.kt
app/src/main/kotlin/dev/minios/ocremote/ui/screens/sessions/components/McpManagementSheet.kt
app/src/main/kotlin/dev/minios/ocremote/ui/screens/sessions/components/ProjectGroupHeader.kt
app/src/test/AndroidManifest.xml
app/src/test/kotlin/dev/minios/ocremote/data/api/OpenCodeApiMcpHeaderTest.kt
app/src/test/kotlin/dev/minios/ocremote/data/api/OpenCodeApiMcpRuntimeTest.kt
app/src/test/kotlin/dev/minios/ocremote/data/repository/ServerRepositoryMcpRuntimeAcceptanceTest.kt
app/src/test/kotlin/dev/minios/ocremote/data/repository/ServerRepositoryMcpRuntimeTest.kt
app/src/test/kotlin/dev/minios/ocremote/domain/model/McpRuntimeTest.kt
app/src/test/kotlin/dev/minios/ocremote/ui/screens/sessions/McpRuntimeViewModelTest.kt
app/src/test/kotlin/dev/minios/ocremote/ui/screens/sessions/McpViewModelTest.kt
app/src/test/kotlin/dev/minios/ocremote/ui/screens/sessions/components/McpManagementSheetRuntimeTest.kt
app/src/test/kotlin/dev/minios/ocremote/ui/screens/sessions/components/ProjectGroupHeaderMcpHintTest.kt
thoughts/shared/designs/2026-04-30-mcp-runtime-toggle-parity-design.md
thoughts/shared/plans/2026-04-30-mcp-runtime-toggle-parity-release.md
```

### Verification output

Command:

```bash
./gradlew test
```

Output:

```text
To honour the JVM settings for this build a single-use Daemon process will be forked. For more on this, please refer to https://docs.gradle.org/8.6/userguide/gradle_daemon.html#sec:disabling_the_daemon in the Gradle documentation.
Daemon will be stopped at the end of the build 

FAILURE: Build failed with an exception.

* What went wrong:
Could not determine the dependencies of task ':app:testDebugUnitTest'.
> SDK location not found. Define a valid SDK location with an ANDROID_HOME environment variable or by setting the sdk.dir path in your project's local properties file at '/root/CODE/issue-21-align-android-mcp-panel-with-opencode-web-runtim/local.properties'.

* Try:
> Run with --stacktrace option to get the stack trace.
> Run with --info or --debug option to get more log output.
> Run with --scan to get full insights.
> Get more help at https://help.gradle.org.

BUILD FAILED in 29s
```

### Merge decision

No merge was attempted. PR #24 is open but blocked because GitHub reports `mergeable=CONFLICTING` / `mergeStateStatus=DIRTY`, and local Gradle verification cannot pass in this worktree without an Android SDK location. The changed-file surface is broad enough that it does not meet the plan's small/mechanical conflict policy.
