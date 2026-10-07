import { describe, expect, it } from "bun:test";
import { settingsEntry, settingsLevels } from "./settingsHistory.ts";

describe("settingsLevels", () => {
  it("makes a phone's list a step of its own, under the page and the key bar editor", () => {
    expect(settingsLevels(true, null, false)).toEqual([{ page: null, keyBar: false }]);
    expect(settingsLevels(true, "chat", false)).toEqual([{ page: null, keyBar: false }, { page: "chat", keyBar: false }]);
    expect(settingsLevels(true, "terminal", true)).toEqual([{ page: null, keyBar: false }, { page: "terminal", keyBar: false }, { page: "terminal", keyBar: true }]);
  });

  it("opens a wider dialog on its page: one step, and the key bar editor a second", () => {
    expect(settingsLevels(false, "appearance", false)).toEqual([{ page: "appearance", keyBar: false }]);
    expect(settingsLevels(false, "terminal", true)).toEqual([{ page: "terminal", keyBar: false }, { page: "terminal", keyBar: true }]);
  });

  it("has no key bar step without a page under it", () => {
    expect(settingsLevels(true, null, true)).toEqual([{ page: null, keyBar: false }]);
  });
});

describe("settingsEntry", () => {
  const state = (entry: unknown) => ({ "herdr-web-ui:settings": entry });

  it("reads the entry beside whatever else the state holds", () => {
    expect(settingsEntry({ ...state({ page: "chat", keyBar: false, depth: 2 }), "herdr-web-ui:file-preview": { path: "a" } })).toEqual({ page: "chat", keyBar: false, depth: 2 });
    expect(settingsEntry(state({ page: null, keyBar: false, depth: 1 }))).toEqual({ page: null, keyBar: false, depth: 1 });
  });

  it("is null for a state without one, or one it did not write", () => {
    for (const other of [null, undefined, "settings", 1, {}, state(null), state("chat"), state({ page: 3, keyBar: false, depth: 1 }), state({ page: "chat", keyBar: "no", depth: 1 }),
      state({ page: "chat", keyBar: false }), state({ page: "chat", keyBar: false, depth: 0 }), state({ page: "chat", keyBar: false, depth: 1.5 }), state({ page: "chat", keyBar: false, depth: 9 })]) {
      expect(settingsEntry(other)).toBeNull();
    }
  });
});
