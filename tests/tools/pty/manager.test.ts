// tests/tools/pty/manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PTYManager } from "../../../src/tools/pty/manager";

describe("PTYManager", () => {
  let manager: PTYManager;

  beforeEach(() => {
    manager = new PTYManager();
  });

  afterEach(() => {
    manager.cleanupAll();
  });

  describe("spawn", () => {
    it("should create a new PTY session", () => {
      const info = manager.spawn({
        command: "echo",
        args: ["hello"],
        parentSessionId: "test-session",
      });

      expect(info.id).toMatch(/^pty_[a-f0-9]{8}$/);
      expect(info.command).toBe("echo");
      expect(info.args).toEqual(["hello"]);
      expect(info.status).toBe("running");
      expect(info.pid).toBeGreaterThan(0);
    });

    it("should use default title from command", () => {
      const info = manager.spawn({
        command: "ls",
        args: ["-la"],
        parentSessionId: "test-session",
      });

      expect(info.title).toBe("ls -la");
    });

    it("should use custom title when provided", () => {
      const info = manager.spawn({
        command: "npm",
        args: ["run", "dev"],
        title: "Dev Server",
        parentSessionId: "test-session",
      });

      expect(info.title).toBe("Dev Server");
    });
  });

  describe("list", () => {
    it("should return all sessions", () => {
      manager.spawn({ command: "echo", args: ["1"], parentSessionId: "s1" });
      manager.spawn({ command: "echo", args: ["2"], parentSessionId: "s1" });

      const sessions = manager.list();
      expect(sessions).toHaveLength(2);
    });

    it("should return empty array when no sessions", () => {
      const sessions = manager.list();
      expect(sessions).toEqual([]);
    });
  });

  describe("get", () => {
    it("should return session by id", () => {
      const spawned = manager.spawn({
        command: "echo",
        parentSessionId: "test",
      });

      const info = manager.get(spawned.id);
      expect(info).not.toBeNull();
      expect(info?.id).toBe(spawned.id);
    });

    it("should return null for unknown id", () => {
      const info = manager.get("pty_nonexistent");
      expect(info).toBeNull();
    });
  });

  describe("write", () => {
    it("should return false for unknown session", () => {
      const result = manager.write("pty_nonexistent", "test");
      expect(result).toBe(false);
    });
  });

  describe("kill", () => {
    it("should kill a running session", () => {
      const info = manager.spawn({
        command: "sleep",
        args: ["10"],
        parentSessionId: "test",
      });

      const killed = manager.kill(info.id);
      expect(killed).toBe(true);

      const updated = manager.get(info.id);
      expect(updated?.status).toBe("killed");
    });

    it("should cleanup session when cleanup=true", () => {
      const info = manager.spawn({
        command: "echo",
        parentSessionId: "test",
      });

      manager.kill(info.id, true);

      const sessions = manager.list();
      expect(sessions).toHaveLength(0);
    });

    it("should return false for unknown session", () => {
      const result = manager.kill("pty_nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("cleanupBySession", () => {
    it("should cleanup all PTYs for a parent session", () => {
      manager.spawn({ command: "echo", parentSessionId: "session-a" });
      manager.spawn({ command: "echo", parentSessionId: "session-a" });
      manager.spawn({ command: "echo", parentSessionId: "session-b" });

      manager.cleanupBySession("session-a");

      const sessions = manager.list();
      expect(sessions).toHaveLength(1);
    });
  });
});
