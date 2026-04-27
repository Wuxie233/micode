import type { Server, ServerWebSocket } from "bun";
import * as v from "valibot";

import { checkPortalAuth } from "@/octto/portal/auth";
import { renderLandingHtml } from "@/octto/portal/landing";
import { createPortalRouter } from "@/octto/portal/register";
import { getHtmlBundle } from "@/octto/ui";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { WsClientMessageSchema } from "./schemas";
import type { SessionStore } from "./sessions";
import type { WsClientMessage } from "./types";

interface WsData {
  sessionId: string;
}

interface SharedServerOptions {
  port?: number;
}

const SESSION_PATH_RE = /^\/s\/([^/]+)\/?$/;
const WS_PATH_RE = /^\/ws\/([^/]+)\/?$/;
const PLACEHOLDER = "__OCTTO_SESSION_ID_PLACEHOLDER__";
const ROOT_NOT_FOUND_BODY = "Octto requires a session-scoped URL: /s/:sessionId";
const portalRouter = createPortalRouter({ checkAuth: checkPortalAuth, renderLanding: renderLandingHtml });

let sharedServer: Server<WsData> | undefined;
let sharedStore: SessionStore | undefined;

export interface SharedServerHandle {
  readonly server: Server<WsData>;
  readonly port: number;
}

export async function getSharedServer(
  store: SessionStore,
  options: SharedServerOptions = {},
): Promise<SharedServerHandle> {
  if (sharedServer) {
    sharedStore = store;
    return { server: sharedServer, port: sharedServer.port ?? 0 };
  }

  const port = options.port ?? config.octto.port;
  sharedStore = store;
  sharedServer = Bun.serve<WsData>({
    port,
    hostname: config.octto.allowRemoteBind ? config.octto.bindAddress : "127.0.0.1",
    fetch: handleFetch,
    websocket: {
      open: (ws) => sharedStore?.handleWsConnect(ws.data.sessionId, ws),
      close: (ws) => sharedStore?.handleWsDisconnect(ws.data.sessionId),
      message: (ws, message) => handleWsMessage(ws, message),
    },
  });

  return { server: sharedServer, port: sharedServer.port ?? 0 };
}

export async function stopSharedServer(): Promise<void> {
  if (!sharedServer) return;
  await sharedServer.stop();
  sharedServer = undefined;
  sharedStore = undefined;
}

function handleFetch(req: Request, server: Server<WsData>): Response | undefined {
  const url = new URL(req.url);

  if (url.pathname === "/healthz") {
    return new Response("ok", { status: 200 });
  }

  const wsMatch = WS_PATH_RE.exec(url.pathname);
  if (wsMatch) return tryUpgrade(req, server, wsMatch[1] ?? "");

  const sessionMatch = SESSION_PATH_RE.exec(url.pathname);
  if (sessionMatch) return serveBundle(sessionMatch[1] ?? "");

  const portal = sharedStore ? portalRouter(req, sharedStore) : undefined;
  if (portal) return portal;

  if (url.pathname === "/index.html") {
    return new Response(ROOT_NOT_FOUND_BODY, { status: 404 });
  }

  return new Response("Not Found", { status: 404 });
}

function tryUpgrade(req: Request, server: Server<WsData>, sessionId: string): Response | undefined {
  if (!sharedStore?.hasSession(sessionId)) {
    return new Response(`Unknown Octto session: ${sessionId}`, { status: 404 });
  }

  const ok = server.upgrade(req, { data: { sessionId } });
  if (ok) return undefined;

  return new Response("WebSocket upgrade failed", { status: 400 });
}

export function serveBundle(sessionId: string, store: SessionStore | undefined = sharedStore): Response {
  if (!store?.hasSession(sessionId)) {
    return new Response(`Unknown Octto session: ${sessionId}`, { status: 404 });
  }

  const injected = injectSessionId(getHtmlBundle(), sessionId);
  return new Response(injected, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function injectSessionId(bundle: string, sessionId: string): string {
  const encoded = escapeScriptString(JSON.stringify(sessionId));
  return bundle.replace(PLACEHOLDER, encoded);
}

function escapeScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("<", "\\u003c");
}

function handleWsMessage(ws: ServerWebSocket<WsData>, message: string | Buffer): void {
  if (!sharedStore) return;

  let raw: unknown;
  try {
    raw = JSON.parse(message.toString());
  } catch (error) {
    log.error("octto", "Failed to parse WebSocket message", error);
    ws.send(JSON.stringify({ type: "error", error: "Invalid message format", details: extractErrorMessage(error) }));
    return;
  }

  const result = v.safeParse(WsClientMessageSchema, raw);
  if (!result.success) {
    log.error("octto", "Invalid WebSocket message schema", result.issues);
    ws.send(
      JSON.stringify({
        type: "error",
        error: "Invalid message schema",
        details: result.issues.map((issue) => issue.message).join("; "),
      }),
    );
    return;
  }

  sharedStore.handleWsMessage(ws.data.sessionId, result.output as WsClientMessage);
}
