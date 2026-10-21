// Sound events: what made a sound, where, and how loud it is at 1 m (dB). The sim emits them;
// the audio layer plays them and never feeds anything back (Brain: sound-engine/E7). Footsteps and
// mouth sounds timed by animation (drinking, tearing) are emitted by the client from its animators.
export type SoundKind = 'bite' | 'hit' | 'call';

export interface SoundEvent {
  kind: SoundKind;
  who: 'player' | 'prey' | 'saurosuchus';
  x: number;
  y: number;
  z: number;
  level: number; // dB at 1 m
  share?: number; // hit: fraction of health the blow took
  call?: 'squeak' | 'growl' | 'yelp';
}
