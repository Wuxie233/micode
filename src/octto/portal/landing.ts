// src/octto/portal/landing.ts

export interface LandingInput {
  readonly pollIntervalMs: number;
  readonly baseUrl: string;
}

const CONVERSATIONS_ENDPOINT = "/api/conversations";
const PORTAL_PATH_PREFIX = "/portal/";
const STATUS_UNAUTHORIZED = 401;

const LANDING_SCRIPT_BODY = [
  "  function escapeHtml(value) {",
  "    return String(value)",
  "      .replace(/&/g, '&amp;')",
  "      .replace(/</g, '&lt;')",
  "      .replace(/>/g, '&gt;')",
  "      .replace(/\"/g, '&quot;');",
  "  }",
  "  function formatAge(ms) {",
  "    if (ms === null || ms === undefined) return '-';",
  "    var seconds = Math.floor(Number(ms) / 1000);",
  "    if (seconds < 60) return seconds + 's';",
  "    var minutes = Math.floor(seconds / 60);",
  "    if (minutes < 60) return minutes + 'm';",
  "    var hours = Math.floor(minutes / 60);",
  "    return hours + 'h';",
  "  }",
  "  function renderRow(summary) {",
  "    var href = portalPrefix + encodeURIComponent(summary.id);",
  "    var title = summary.title === null || summary.title === undefined ? summary.id : summary.title;",
  "    var pending = Number(summary.pendingCount || 0);",
  "    var age = formatAge(summary.oldestPendingAgeMs);",
  "    var owner = escapeHtml(summary.ownerSessionId || '');",
  "    var created = escapeHtml(summary.createdAt || '');",
  '    return \'<a class="row" data-testid="conversation-row" href="\' + escapeHtml(href) + \'">\' +',
  "      '<span class=\"title\">' + escapeHtml(title) + '</span>' +",
  "      '<span class=\"pending\">' + escapeHtml(String(pending)) + ' pending</span>' +",
  "      '<span class=\"age\">' + escapeHtml(age) + '</span>' +",
  "      '<span class=\"meta\">owner=' + owner + ' created=' + created + '</span>' +",
  "    '</a>';",
  "  }",
  "  function renderUnauthorized() {",
  "    var root = document.getElementById('root');",
  "    if (!root) return;",
  "    root.innerHTML = '<div class=\"unauthorized\">Unauthorized (' + unauthorizedStatus + ')</div>';",
  "  }",
  "  function renderList(conversations) {",
  "    var root = document.getElementById('root');",
  "    if (!root) return;",
  "    if (!conversations || conversations.length === 0) {",
  '      root.innerHTML = \'<div data-testid="empty-state" class="empty">No active conversations</div>\';',
  "      return;",
  "    }",
  "    var html = '';",
  "    for (var i = 0; i < conversations.length; i++) {",
  "      html += renderRow(conversations[i]);",
  "    }",
  "    root.innerHTML = html;",
  "  }",
  "  function refresh() {",
  "    fetch(endpoint, { credentials: 'same-origin' })",
  "      .then(function (response) {",
  "        if (response.status === unauthorizedStatus) {",
  "          renderUnauthorized();",
  "          return null;",
  "        }",
  "        if (!response.ok) return null;",
  "        return response.json();",
  "      })",
  "      .then(function (payload) {",
  "        if (!payload) return;",
  "        renderList(payload.conversations || []);",
  "      })",
  "      .catch(function () {});",
  "  }",
  "  refresh();",
] as const;

export function renderLandingHtml(input: LandingInput): string {
  const pollIntervalMs = Math.max(0, Math.trunc(input.pollIntervalMs));
  const script = buildLandingScript(pollIntervalMs);
  return buildLandingDocument(script, input.baseUrl);
}

function buildLandingScript(pollIntervalMs: number): string {
  return [
    "(function () {",
    `  var endpoint = ${JSON.stringify(CONVERSATIONS_ENDPOINT)};`,
    `  var portalPrefix = ${JSON.stringify(PORTAL_PATH_PREFIX)};`,
    `  var unauthorizedStatus = ${STATUS_UNAUTHORIZED};`,
    ...LANDING_SCRIPT_BODY,
    `  setInterval(refresh, ${pollIntervalMs});`,
    "})();",
  ].join("\n");
}

function buildLandingDocument(script: string, baseUrl: string): string {
  const baseTag = baseUrl ? `<meta name="octto-portal-base" content="${escapeAttribute(baseUrl)}">` : "";
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "  <title>Octto Portal</title>",
    `  ${baseTag}`,
    "  <style>",
    "    body { font-family: ui-monospace, monospace; margin: 0; padding: 1.5rem; background: #fff; color: #000; }",
    "    h1 { font-size: 1rem; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 1rem; }",
    "    #root { display: flex; flex-direction: column; gap: 0.5rem; }",
    "    .row { display: grid; grid-template-columns: 1fr auto auto; gap: 1rem;",
    "      padding: 0.75rem 1rem; border: 1px solid #000; text-decoration: none; color: inherit; }",
    "    .row:hover { background: #f1f3f4; }",
    "    .title { font-weight: 600; }",
    "    .pending { color: #aa0000; }",
    "    .age { color: #666; }",
    "    .meta { grid-column: 1 / -1; font-size: 0.75rem; color: #666; }",
    "    .empty { padding: 2rem; text-align: center; color: #666; border: 1px dashed #ccc; }",
    "    .unauthorized { padding: 2rem; text-align: center; color: #aa0000; border: 1px solid #aa0000; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <h1>Octto Portal: Active Conversations</h1>",
    '  <div id="root"></div>',
    "  <script>",
    script,
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
