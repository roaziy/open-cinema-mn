/**
 * After the phone was locked or the tab hidden, iOS suspends Web Audio and may end the camera.
 * When either is gone the scanner must go back to the "Эхлэх" tap, which can restore both: a
 * screen that looks live but is blind or mute is the worst outcome at a door.
 */
export function needsRestart(s: {
  audio: AudioContextState | 'none';
  tracks: { readyState: 'live' | 'ended'; muted: boolean }[];
}): boolean {
  if (s.audio !== 'running' && s.audio !== 'none') return true;
  if (s.tracks.length === 0) return true;
  return s.tracks.some((t) => t.readyState !== 'live' || t.muted);
}
