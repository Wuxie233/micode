import { afterEach, describe, expect, it } from "bun:test";

import { COOKIE_NAME, checkPortalAuth } from "@/octto/portal/auth";
import { config } from "@/utils/config";

const BASE_URL = "https://octto.example.test";
const PORTAL_TOKEN = "valid-portal-token";
const WRONG_TOKEN = "wrong-portal-token";
const ROOT_PATH = "/";
const PORTAL_PATH = "/portal";
const API_PATH = "/api/conversations";
const TOKEN_PARAM = "token";
const ORIGINAL_PORTAL_TOKEN = config.octto.portalToken;

function setPortalToken(token: string): void {
  Object.defineProperty(config.octto, "portalToken", {
    configurable: true,
    enumerable: true,
    value: token,
    writable: true,
  });
}

function createRequest(path: string, headers?: HeadersInit): Request {
  return new Request(`${BASE_URL}${path}`, { headers });
}

function createCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function createQuery(path: string, token: string): string {
  return `${path}?${TOKEN_PARAM}=${encodeURIComponent(token)}`;
}

describe("checkPortalAuth", () => {
  afterEach(() => {
    setPortalToken(ORIGINAL_PORTAL_TOKEN);
  });

  it("authorizes without setting a cookie when portal auth is disabled", () => {
    setPortalToken("");

    expect(checkPortalAuth(createRequest(createQuery(API_PATH, WRONG_TOKEN)))).toEqual({
      authorized: true,
      setCookie: null,
    });
  });

  it("authorizes a valid root query token and returns a portal cookie", () => {
    setPortalToken(PORTAL_TOKEN);

    const auth = checkPortalAuth(createRequest(createQuery(ROOT_PATH, PORTAL_TOKEN)));

    expect(auth.authorized).toBe(true);
    expect(auth.setCookie).toContain(`${COOKIE_NAME}=${encodeURIComponent(PORTAL_TOKEN)}`);
    expect(auth.setCookie).toContain("Path=/");
    expect(auth.setCookie).toContain("HttpOnly");
  });

  it("authorizes a valid portal query token and returns a portal cookie", () => {
    setPortalToken(PORTAL_TOKEN);

    const auth = checkPortalAuth(createRequest(createQuery(PORTAL_PATH, PORTAL_TOKEN)));

    expect(auth.authorized).toBe(true);
    expect(auth.setCookie).toContain(`${COOKIE_NAME}=${encodeURIComponent(PORTAL_TOKEN)}`);
  });

  it("authorizes a valid portal cookie", () => {
    setPortalToken(PORTAL_TOKEN);

    expect(checkPortalAuth(createRequest(API_PATH, { cookie: createCookie(PORTAL_TOKEN) }))).toEqual({
      authorized: true,
      setCookie: null,
    });
  });

  it("denies missing tokens", () => {
    setPortalToken(PORTAL_TOKEN);

    expect(checkPortalAuth(createRequest(API_PATH))).toEqual({ authorized: false, setCookie: null });
  });

  it("denies invalid query tokens", () => {
    setPortalToken(PORTAL_TOKEN);

    expect(checkPortalAuth(createRequest(createQuery(ROOT_PATH, WRONG_TOKEN)))).toEqual({
      authorized: false,
      setCookie: null,
    });
  });

  it("denies invalid cookie tokens", () => {
    setPortalToken(PORTAL_TOKEN);

    expect(checkPortalAuth(createRequest(ROOT_PATH, { cookie: createCookie(WRONG_TOKEN) }))).toEqual({
      authorized: false,
      setCookie: null,
    });
  });

  it("denies query tokens on API paths", () => {
    setPortalToken(PORTAL_TOKEN);

    expect(checkPortalAuth(createRequest(createQuery(API_PATH, PORTAL_TOKEN)))).toEqual({
      authorized: false,
      setCookie: null,
    });
  });
});
