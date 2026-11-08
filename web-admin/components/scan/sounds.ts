import { type SoundKind, VIBRATION } from '@/lib/scan/card';

let ctx: AudioContext | null = null;

/**
 * Must run inside the "Эхлэх" tap: iOS Safari only lets Web Audio start from a gesture, and it
 * has no vibration, so the sound is the one signal that always works.
 */
export function unlockAudio(): void {
  try {
    ctx ??= new (
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    void ctx.resume();
    // A silent blip finishes the unlock on iOS.
    const g = ctx.createGain();
    g.gain.value = 0;
    const o = ctx.createOscillator();
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
  } catch {
    // No audio: the card colour and vibration still carry the result.
  }
}

type Note = { hz: number; at: number; len: number; type: OscillatorType; vol: number };

const TONES: Record<SoundKind, Note[]> = {
  // Rising pair: reads as "go".
  admit: [
    { hz: 784, at: 0, len: 0.09, type: 'sine', vol: 0.32 },
    { hz: 1175, at: 0.1, len: 0.16, type: 'sine', vol: 0.32 },
  ],
  // One flat mid tone: nothing new happened.
  repeat: [{ hz: 660, at: 0, len: 0.14, type: 'triangle', vol: 0.26 }],
  // Low buzzing pair: reads as "stop".
  reject: [
    { hz: 180, at: 0, len: 0.16, type: 'square', vol: 0.2 },
    { hz: 150, at: 0.2, len: 0.26, type: 'square', vol: 0.2 },
  ],
};

export function signal(kind: SoundKind): void {
  try {
    navigator.vibrate?.(VIBRATION[kind]);
  } catch {
    // Not every browser allows it.
  }
  const c = ctx;
  if (!c) return;
  const t0 = c.currentTime;
  for (const n of TONES[kind]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type;
    osc.frequency.value = n.hz;
    gain.gain.setValueAtTime(0.0001, t0 + n.at);
    gain.gain.exponentialRampToValueAtTime(n.vol, t0 + n.at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.len + 0.02);
  }
}
