import type { CallStyle } from './calls';

// Sound events: what made a sound, where, and how loud it is at 1 m (dB). The sim emits them;
// the audio layer plays them and never feeds anything back (Brain: sound-engine/E7). Footsteps and
// mouth sounds timed by animation (drinking, tearing) are emitted by the client from its animators.
export type SoundKind = 'bite' | 'hit' | 'call' | 'step' | 'skid' | 'thud' | 'scramble';

export interface SoundEvent {
  kind: SoundKind;
  who: 'player' | 'prey' | 'saurosuchus';
  x: number;
  y: number;
  z: number;
  level: number; // dB at 1 m
  id?: number; // the entity that made it (PLAYER_ID for the player), for hearing
  share?: number; // hit: fraction of health the blow took
  left?: number; // hit: the victim's health after it (0 = killed)
  target?: number; // hit: the entity bitten (PLAYER_ID - slot for players)
  yaw?: number; // bite and hit: the heading of the strike, for knockback and spray
  miss?: boolean; // bite: snapped on air
  blow?: 'kick' | 'swipe'; // hit: a kick or tail swipe rather than a bite
  dur?: number; // skid: s the foot drags
  mass?: number; // skid, thud, scramble: the body's mass, kg
  surface?: 'water' | 'mud' | 'rock' | 'log' | 'dirt'; // skid, thud, scramble: what it's on
  call?: 'squeak' | 'growl' | 'yelp' | CallStyle; // CallStyle: a player call, played from the CALLS table
}
