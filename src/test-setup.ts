// Global test setup — runs before each bun:test file via bunfig.toml.
// Installs happy-dom so any test that imports React, uses `document`,
// or reads window globals works without per-file environment pragmas.
import { Window } from "happy-dom";

// Tell React 19 that `act()` is supported in this environment.
// Without this flag, every test prints "current testing environment is
// not configured to support act(...)" and React's updates don't
// flush synchronously, so DOM assertions see stale trees.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const win = new Window({ url: "http://localhost:3028" });

// happy-dom's Window already provides `document`, `window`, `navigator`,
// `HTMLElement`, etc. on its own prototype chain. Assigning the
// instance globals guarantees they're reachable from any module that
// reads them as bare identifiers (e.g. `document.createElement(...)`).
const g = globalThis as unknown as Record<string, unknown>;
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "localStorage",
  "Notification",
  "AudioContext",
]) {
  g[key] = (win as unknown as Record<string, unknown>)[key];
}

// AudioContext mock — playGoalSound.ts instantiates AudioContext lazily.
// Without this mock, happy-dom throws because there's no real audio
// backend in the test runner.
g.AudioContext = class MockAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = {};
  createOscillator() {
    return {
      frequency: { value: 0 },
      type: "sine",
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
};