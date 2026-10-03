/**
 * The alert sound: a short chime the open tab plays itself when an alert is due. It is page
 * audio, not a system notification, so it is heard where notifications stay quiet - a macOS
 * Focus, Do Not Disturb - as long as a tab of the app is open.
 *
 * A browser lets a page play audio only after the user interacted with it, so the audio context
 * is made and resumed from a tap or key (`unlockAlertSound`); until then a chime is skipped,
 * never queued to sound late.
 */

export type AlertSoundKind = "blocked" | "done";

/** Each chime's notes in Hz: a question rises, a finish falls. */
export const CHIME_NOTES: Readonly<Record<AlertSoundKind, readonly number[]>> = {
  blocked: [660, 880],
  done: [880, 660],
};
const NOTE_GAP_S = 0.16;
const NOTE_LENGTH_S = 0.3;
const PEAK_GAIN = 0.25;

let context: AudioContext | null = null;

function contextClass(): typeof AudioContext | undefined {
  return globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

/** From a user gesture: lets this tab's later chimes play. Resolves whether it can play now. */
export async function unlockAlertSound(): Promise<boolean> {
  const Context = contextClass();
  if (!Context) return false;
  // a context the browser closed never resumes: the next gesture makes a new one
  if (!context || context.state === "closed") context = new Context();
  // suspended before the first gesture, or "interrupted" (iOS Safari, after a call or a switch away):
  // both resume from a gesture
  if (context.state !== "running") {
    try {
      await context.resume();
    } catch {
      return false;
    }
  }
  return context.state === "running";
}

export function playAlertSound(kind: AlertSoundKind): void {
  const audio = context;
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime;
  CHIME_NOTES[kind].forEach((frequency, index) => {
    const at = start + index * NOTE_GAP_S;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    // a ramp from near silence on both ends: a note that starts or stops at full level clicks
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH_S);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + NOTE_LENGTH_S);
  });
}
