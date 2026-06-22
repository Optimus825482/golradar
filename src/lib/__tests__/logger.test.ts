import { describe, expect, test } from "bun:test";
import { logger, getLogger } from "../logger";

describe("logger: sync proxy", () => {
  test("info() does not throw", () => {
    expect(() => logger.info({ foo: "bar" }, "test")).not.toThrow();
  });

  test("warn() does not throw", () => {
    expect(() => logger.warn({ foo: "bar" }, "warn test")).not.toThrow();
  });

  test("error() does not throw", () => {
    expect(() => logger.error({ err: "x" }, "error test")).not.toThrow();
  });

  test("debug() does not throw", () => {
    expect(() => logger.debug({ x: 1 }, "debug test")).not.toThrow();
  });

  test("info() with only obj (no msg) does not throw", () => {
    expect(() => logger.info({ only: "obj" })).not.toThrow();
  });

  test("child() returns a usable logger", () => {
    const child = logger.child({ requestId: "abc-123" });
    expect(() => child.info({}, "child log")).not.toThrow();
    expect(() => child.warn({}, "child warn")).not.toThrow();
  });

  test("nested child does not throw", () => {
    const child = logger.child({ a: 1 }).child({ b: 2 });
    expect(() => child.info({}, "nested")).not.toThrow();
  });
});

describe("logger: getLogger (async)", () => {
  test("resolves to a logger instance", async () => {
    const l = await getLogger();
    expect(l).toBeDefined();
    expect(typeof l.info).toBe("function");
    expect(typeof l.warn).toBe("function");
    expect(typeof l.error).toBe("function");
    expect(typeof l.debug).toBe("function");
    expect(typeof l.child).toBe("function");
  });

  test("returned logger can log without throwing", async () => {
    const l = await getLogger();
    expect(() => l.info({ test: 1 }, "async logger")).not.toThrow();
  });

  test("child of async logger also works", async () => {
    const l = await getLogger();
    const child = l.child({ scope: "test" });
    expect(() => child.info({}, "async child")).not.toThrow();
  });
});
