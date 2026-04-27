// tests/tools/octto/config.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const PORT_ENV = "OCTTO_PORT";
const PUBLIC_BASE_URL_ENV = "OCTTO_PUBLIC_BASE_URL";

async function loadConfig(cacheKey: string): Promise<typeof import("../../../src/utils/config").config> {
  const mod = await import(`../../../src/utils/config.ts?cache=${cacheKey}`);
  return mod.config;
}

describe("config.octto environment variables", () => {
  let originalPort: string | undefined;
  let originalPublicBaseUrl: string | undefined;

  beforeEach(() => {
    originalPort = process.env[PORT_ENV];
    originalPublicBaseUrl = process.env[PUBLIC_BASE_URL_ENV];
    delete process.env[PORT_ENV];
    delete process.env[PUBLIC_BASE_URL_ENV];
  });

  afterEach(() => {
    if (originalPort === undefined) delete process.env[PORT_ENV];
    else process.env[PORT_ENV] = originalPort;
    if (originalPublicBaseUrl === undefined) delete process.env[PUBLIC_BASE_URL_ENV];
    else process.env[PUBLIC_BASE_URL_ENV] = originalPublicBaseUrl;
  });

  it("defaults port to 0 when OCTTO_PORT is unset", async () => {
    const config = await loadConfig("default-port");
    expect(config.octto.port).toBe(0);
  });

  it("defaults publicBaseUrl to empty string when OCTTO_PUBLIC_BASE_URL is unset", async () => {
    const config = await loadConfig("default-public-base-url");
    expect(config.octto.publicBaseUrl).toBe("");
  });

  it("reads OCTTO_PORT and parses it as a base-10 integer", async () => {
    process.env[PORT_ENV] = "4302";
    const config = await loadConfig("override-port");
    expect(config.octto.port).toBe(4302);
  });

  it("reads OCTTO_PUBLIC_BASE_URL and trims whitespace and trailing slashes", async () => {
    process.env[PUBLIC_BASE_URL_ENV] = "  https://octto.wuxie233.com/  ";
    const config = await loadConfig("override-public-base-url");
    expect(config.octto.publicBaseUrl).toBe("https://octto.wuxie233.com");
  });

  it("preserves existing octto fields when env overrides are applied", async () => {
    process.env[PORT_ENV] = "4302";
    process.env[PUBLIC_BASE_URL_ENV] = "https://octto.wuxie233.com/";
    const config = await loadConfig("preserve-existing");
    expect(config.octto.bindAddress).toBe("127.0.0.1");
    expect(config.octto.allowRemoteBind).toBe(false);
    expect(config.octto.port).toBe(4302);
    expect(config.octto.publicBaseUrl).toBe("https://octto.wuxie233.com");
  });
});
