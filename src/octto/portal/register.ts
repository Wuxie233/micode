import { serveBundle } from "@/octto/session/server";
import type { SessionStore } from "@/octto/session/sessions";
import { config } from "@/utils/config";

import type { checkPortalAuth } from "./auth";
import { handleConversationQuestions, handleConversationsList } from "./conversations";
import type { renderLandingHtml } from "./landing";

const GET_METHOD = "GET";
const ROOT_PATH = "/";
const PORTAL_PATH = "/portal";
const API_CONVERSATIONS_PATH = "/api/conversations";
const PORTAL_CONVERSATION_RE = /^\/portal\/([^/]+)\/?$/;
const API_QUESTIONS_RE = /^\/api\/conversations\/([^/]+)\/questions\/?$/;
const OK_STATUS = 200;
const UNAUTHORIZED_STATUS = 401;
const UNAUTHORIZED_TEXT = "Unauthorized";
const UNAUTHORIZED_HTML = "<!doctype html><title>Octto</title><body>Unauthorized</body>";
const CONTENT_TYPE_HEADER = "Content-Type";
const SET_COOKIE_HEADER = "Set-Cookie";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

function matchPath(pattern: RegExp, pathname: string): string | null {
  return pattern.exec(pathname)?.[1] ?? null;
}

function isLandingPath(pathname: string): boolean {
  return pathname === ROOT_PATH || pathname === PORTAL_PATH;
}

function htmlHeaders(setCookie: string | null): Headers {
  const headers = new Headers({ [CONTENT_TYPE_HEADER]: HTML_CONTENT_TYPE });
  if (setCookie) headers.set(SET_COOKIE_HEADER, setCookie);
  return headers;
}

function htmlResponse(body: string, status: number, setCookie: string | null = null): Response {
  return new Response(body, { status, headers: htmlHeaders(setCookie) });
}

function unauthorizedPortal(): Response {
  return htmlResponse(UNAUTHORIZED_HTML, UNAUTHORIZED_STATUS);
}

function unauthorizedApi(): Response {
  return new Response(UNAUTHORIZED_TEXT, { status: UNAUTHORIZED_STATUS });
}

function handleLanding(
  req: Request,
  input: { readonly checkAuth: typeof checkPortalAuth; readonly renderLanding: typeof renderLandingHtml },
): Response {
  const auth = input.checkAuth(req);
  if (!auth.authorized) return unauthorizedPortal();

  const html = input.renderLanding({
    pollIntervalMs: config.octto.conversationsPollIntervalMs,
    baseUrl: config.octto.portalBaseUrl,
  });
  return htmlResponse(html, OK_STATUS, auth.setCookie);
}

function handlePortalConversation(
  req: Request,
  store: SessionStore,
  checkAuth: typeof checkPortalAuth,
  conversationId: string,
): Response {
  const auth = checkAuth(req);
  if (!auth.authorized) return unauthorizedPortal();

  return serveBundle(conversationId, store);
}

function handleApi(req: Request, checkAuth: typeof checkPortalAuth, respond: () => Response): Response {
  const auth = checkAuth(req);
  if (!auth.authorized) return unauthorizedApi();

  return respond();
}

function handlePortalRoute(
  req: Request,
  store: SessionStore,
  input: { readonly checkAuth: typeof checkPortalAuth; readonly renderLanding: typeof renderLandingHtml },
  pathname: string,
): Response | undefined {
  if (isLandingPath(pathname)) return handleLanding(req, input);

  const conversationId = matchPath(PORTAL_CONVERSATION_RE, pathname);
  if (!conversationId) return undefined;

  return handlePortalConversation(req, store, input.checkAuth, conversationId);
}

function handleApiRoute(
  req: Request,
  store: SessionStore,
  checkAuth: typeof checkPortalAuth,
  pathname: string,
): Response | undefined {
  if (pathname === API_CONVERSATIONS_PATH) return handleApi(req, checkAuth, () => handleConversationsList(store));

  const conversationId = matchPath(API_QUESTIONS_RE, pathname);
  if (!conversationId) return undefined;

  return handleApi(req, checkAuth, () => handleConversationQuestions(store, conversationId));
}

export function createPortalRouter(input: {
  readonly checkAuth: typeof checkPortalAuth;
  readonly renderLanding: typeof renderLandingHtml;
}): (req: Request, store: SessionStore) => Response | undefined {
  return (req, store) => {
    if (req.method !== GET_METHOD) return undefined;

    const url = new URL(req.url);
    const portal = handlePortalRoute(req, store, input, url.pathname);
    if (portal) return portal;

    return handleApiRoute(req, store, input.checkAuth, url.pathname);
  };
}
