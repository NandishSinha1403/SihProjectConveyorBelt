/**
 * Audible alarm for critical defects.
 *
 * A monitoring system that only speaks visually assumes someone is looking at
 * it. In a control room the operator is usually looking at the belt, the
 * paperwork, or another screen — so a critical defect needs to reach them
 * through the air.
 *
 * Synthesised with Web Audio rather than shipped as a file: no asset to load,
 * no request to fail, and it works offline in a mine. Two descending tones,
 * short and dry — a klaxon is unbearable across an eight-hour shift, and
 * anything melodic reads as a notification rather than an alarm.
 */

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Browsers refuse to start audio until the page has been interacted with.
 * Call this from a real user gesture (the toggle itself) so the first genuine
 * alarm is not the one that gets swallowed.
 */
export async function primeAudio(): Promise<boolean> {
  const audio = context();
  if (!audio) return false;
  try {
    if (audio.state === "suspended") await audio.resume();
    return audio.state === "running";
  } catch {
    return false;
  }
}

export function playAlarm(): void {
  const audio = context();
  if (!audio || audio.state !== "running") return;

  const now = audio.currentTime;
  // Two falling tones. A rising pair reads as "ready"; a falling pair reads as
  // "something is wrong", which is the message.
  for (const [index, freq] of [880, 620].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const start = now + index * 0.16;

    osc.type = "triangle"; // softer than a square, still cuts through noise
    osc.frequency.setValueAtTime(freq, start);

    // Shaped envelope: an abrupt gate click is fatiguing.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.14, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.16);
  }
}
