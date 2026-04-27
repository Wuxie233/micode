import { config } from "@/utils/config";

export const COOKIE_NAME = "octto_portal_token";

export interface AuthResult {
  readonly authorized: boolean;
  readonly setCookie: string | null;
}

const ROOT_PATH = "/";
const PORTAL_PATH = "/portal";
const GET_METHOD = "GET";
const COOKIE_HEADER = "cookie";
const TOKEN_PARAM = "token";
const COOKIE_SEPARATOR = ";";
const COOKIE_ASSIGNMENT = "=";
const COOKIE_PREFIX = `${COOKIE_NAME}${COOKIE_ASSIGNMENT}`;
const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; SameSite=Lax";
const AUTHORIZED: AuthResult = { authorized: true, setCookie: null };
const DENIED: AuthResult = { authorized: false, setCookie: null };

function isLandingRequest(req: Request, url: URL): boolean {
  if (req.method !== GET_METHOD) return false;
  return url.pathname === ROOT_PATH || url.pathname === PORTAL_PATH;
}

function readQueryToken(req: Request, url: URL): string | null {
  if (!isLandingRequest(req, url)) return null;
  return url.searchParams.get(TOKEN_PARAM);
}

function readCookieToken(req: Request): string | null {
  const header = req.headers.get(COOKIE_HEADER);
  if (!header) return null;

  for (const entry of header.split(COOKIE_SEPARATOR)) {
    const cookie = entry.trim();
    if (!cookie.startsWith(COOKIE_PREFIX)) continue;
    return decodeCookie(cookie.slice(COOKIE_PREFIX.length));
  }

  return null;
}

function decodeCookie(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed cookies should fail auth without breaking unrelated portal requests.
    return null;
  }
}

function createSetCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${COOKIE_ATTRIBUTES}`;
}

export function checkPortalAuth(req: Request): AuthResult {
  const expected = config.octto.portalToken;
  if (expected === "") return AUTHORIZED;

  const url = new URL(req.url);
  if (readCookieToken(req) === expected) return AUTHORIZED;
  if (readQueryToken(req, url) !== expected) return DENIED;

  return { authorized: true, setCookie: createSetCookie(expected) };
}
