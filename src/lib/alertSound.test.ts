import { afterAll, describe, expect, it } from "bun:test";
import { CHIME_NOTES, playAlertSound, unlockAlertSound } from "./alertSound.ts";

/** A stand-in AudioContext that starts suspended, as a page's does before any tap or key. */
const started: number[] = [];
let resumes = 0;
const made: FakeAudioContext[] = [];
class FakeAudioContext {
  // "interrupted" is iOS Safari's state after a phone call or a switch away: not in the DOM typings
  state: "suspended" | "running" | "closed" | "interrupted" = "suspended";
  constructor() { made.push(this); }
  currentTime = 0;
  destination = {};
  async resume() { resumes += 1; this.state = "running"; }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (node: unknown) => node };
  }
  createOscillator() {
    const oscillator = {
      type: "",
      frequency: { value: 0 },
      connect: (node: unknown) => node,
      start() { started.push(oscillator.frequency.value); },
      stop() {},
    };
    return oscillator;
  }
}

const saved = (globalThis as { AudioContext?: unknown }).AudioContext;
Object.assign(globalThis, { AudioContext: FakeAudioContext });
afterAll(() => { Object.assign(globalThis, { AudioContext: saved }); });

describe("alert sound", () => {
  it("skips a chime before the page was allowed to play audio, instead of queueing it", () => {
    playAlertSound("blocked");
    expect(started).toEqual([]);
  });

  it("plays each kind's notes once a gesture unlocked the tab", async () => {
    expect(await unlockAlertSound()).toBe(true);
    expect(resumes).toBe(1);
    playAlertSound("blocked");
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.blocked, ...CHIME_NOTES.done]);
  });

  it("tells a question, which rises, from a finish, which falls", () => {
    expect(CHIME_NOTES.blocked[0]!).toBeLessThan(CHIME_NOTES.blocked[1]!);
    expect(CHIME_NOTES.done[0]!).toBeGreaterThan(CHIME_NOTES.done[1]!);
  });

  it("reuses the running context on later gestures", async () => {
    expect(await unlockAlertSound()).toBe(true);
    expect(resumes).toBe(1);
    expect(made.length).toBe(1);
  });

  it("makes a new context on the next gesture once the browser closed the old one", async () => {
    made[0]!.state = "closed";
    started.length = 0;
    playAlertSound("done");
    expect(started).toEqual([]);
    expect(await unlockAlertSound()).toBe(true);
    expect(made.length).toBe(2);
    playAlertSound("done");
    expect(started).toEqual([...CHIME_NOTES.done]);
  });

  it("resumes a context iOS Safari interrupted, on the next gesture", async () => {
    made.at(-1)!.state = "interrupted";
    started.length = 0;
    playAlertSound("blocked");
    expect(started).toEqual([]);
    const before = resumes;
    expect(await unlockAlertSound()).toBe(true);
    expect(resumes).toBe(before + 1);
    expect(made.length).toBe(2);
    playAlertSound("blocked");
    expect(started).toEqual([...CHIME_NOTES.blocked]);
  });
});
