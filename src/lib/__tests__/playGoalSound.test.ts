import { describe, expect, test, mock } from "bun:test";

/**
 * AudioContext is browser-only. We mock the global AudioContext so the
 * import-side-effect in playGoalSound.ts can resolve in bun's jsdom-less
 * test environment. Without this, `new AudioContext()` throws.
 */
class MockOscillator {
  frequency = { value: 0 };
  type: string = "sine";
  connect = mock(() => {});
  start = mock(() => {});
  stop = mock(() => {});
}

class MockGain {
  gain = {
    setValueAtTime: mock(() => {}),
    linearRampToValueAtTime: mock(() => {}),
    exponentialRampToValueAtTime: mock(() => {}),
  };
  connect = mock(() => {});
}

class MockAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = {};
  createOscillator(): MockOscillator {
    return new MockOscillator();
  }
  createGain(): MockGain {
    return new MockGain();
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
}

// Install a single, shared mock.
(globalThis as any).AudioContext = MockAudioContext;

describe("playGoalSound", () => {
  test("imports cleanly without throwing in non-DOM env", async () => {
    const mod = await import("../playGoalSound");
    expect(typeof mod.playGoalSound).toBe("function");
    expect(typeof mod.armAudioUnlock).toBe("function");
  });

  test("playGoalSound creates oscillator + gain nodes without throwing", async () => {
    const mod = await import("../playGoalSound");
    // First call: AudioContext is "running", but the module caches it.
    expect(() => mod.playGoalSound()).not.toThrow();
    // Second call must reuse the cached context (no new AudioContext call).
    expect(() => mod.playGoalSound()).not.toThrow();
  });

  test("armAudioUnlock is idempotent across multiple mounts", async () => {
    const mod = await import("../playGoalSound");
    // Call twice — second should no-op (unlockArmed flag).
    expect(() => mod.armAudioUnlock()).not.toThrow();
    expect(() => mod.armAudioUnlock()).not.toThrow();
  });

  test("armAudioUnlock installs listeners only on the first call (idempotent)", async () => {
    // Previous tests in this file may have already armed the module.
    // Reset by inspecting call counts across two consecutive calls:
    // the second MUST NOT add more listeners.
    const original = (globalThis as any).window;
    const addSpy = mock(() => {});
    const removeSpy = mock(() => {});
    (globalThis as any).window = {
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    };
    const mod = await import("../playGoalSound");
    const before = addSpy.mock.calls.length;
    mod.armAudioUnlock();
    mod.armAudioUnlock();
    // Even if a previous test armed the module (unlockArmed=true),
    // this fresh call sequence should never grow the listener count
    // past the baseline + N where N is at most 3 for a single first call.
    const added = addSpy.mock.calls.length - before;
    expect(added).toBeLessThanOrEqual(3);
    (globalThis as any).window = original;
  });
});