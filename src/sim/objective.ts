// What to do next: a rolling objective worked out from live state every frame, never stored (Brain: compute
// progress from live state with a priority ladder, so it can't drift out of step with the game). The first rung
// that applies wins: danger, then what will kill it soonest, then growing up. Text uses {eat}, {drink}, {rest}
// and {go} for the device's buttons; the client fills them in. No DOM here: the sim must run headless.
import { bitesToKill } from './combat';
import { HYPERODAPEDON } from './herbivore';
import { SAUROSUCHUS } from './saurosuchus';
import { exposed } from './smallprey';
import { browseAt } from './flora';
import { PONDS, waterDepthAt } from './terrain';
import { stageOf } from './growth';
import { TICK_DT, type PlayerSlot, type World } from './world';

export interface Objective {
  key: string; // stable per rung, for the client to notice a change
  say: string;
  sub: string;
  at: { x: number; z: number } | null; // where the marker stands, if there's a place to go
}

const OBJ = {
  danger: 22, // m: a hunting Saurosuchus this close comes first
  drinkNow: 0.35, // below this the need is urgent (above anything but danger)
  eatNow: 0.35,
  heal: 0.4, // health below this: rest up before anything but food and water
  drink: 0.65,
  eat: 0.65,
  tired: 0.2,
  carcass: 60, // m: a carcass this close beats hunting
  bites: 4, // prey it could kill in this many bites is worth chasing
  huntNear: 25, // m: prey this close beats digging for grubs
  grubs: 40, // m: grubs this close beat a long hunt
};

// The water's edge nearest to it: walk in from the pond centre's far side.
function waterEdge(x: number, z: number): { x: number; z: number } {
  let best = PONDS[0], bd = Infinity;
  for (const p of PONDS) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  const a = Math.atan2(x - best.x, z - best.z);
  for (let r = 0; r < best.r + best.flat; r += 0.5) {
    const ex = best.x + Math.sin(a) * r, ez = best.z + Math.cos(a) * r;
    if (waterDepthAt(ex, ez) < 0.15) return { x: ex, z: ez };
  }
  return { x: best.x, z: best.z };
}

function nearestGrub(w: World, x: number, z: number, now: number): { x: number; z: number } | null {
  let g = null as null | { x: number; z: number }, gd = OBJ.grubs;
  for (const k of w.grubs) {
    const dist = Math.hypot(k.x - x, k.z - z);
    if (k.readyAt <= now && dist < gd) {
      gd = dist;
      g = k;
    }
  }
  return g;
}

// The best meal in reach of the senses: a carcass first, then something it can take down, then grubs.
function food(w: World, slot: PlayerSlot): Objective {
  const d = slot.dino, now = w.tick * TICK_DT;
  let c = null as null | { x: number; z: number }, cd = OBJ.carcass;
  for (const k of w.carcasses) {
    const dist = Math.hypot(k.x - d.x, k.z - d.z);
    if (dist < cd) {
      cd = dist;
      c = k;
    }
  }
  if (c) return { key: 'carcass', say: 'Eat from the carcass', sub: 'Stand over it and hold {eat}. Others will come for it too.', at: c };
  const sp = d.species;
  // An aetosaur roots and browses; it doesn't hunt.
  if (sp.diet === 'rooter') {
    if (browseAt(d.x, d.z) > 0.5) return { key: 'browse', say: 'Browse the ferns', sub: 'Hold {eat} to crop the ferns where you stand.', at: null };
    const g = nearestGrub(w, d.x, d.z, now);
    return g ? { key: 'grubs', say: 'Root for grubs', sub: 'Your shovel snout digs them out. Hold {eat} over turned earth, or find ferns.', at: g }
      : { key: 'ferns', say: 'Find ferns', sub: 'Thick ferns grow in clumps across the valley floor.', at: null };
  }
  // A water ambusher: wait in the pond for whatever comes down to drink, or take the fish.
  if (sp.swim > 0 && sp.diet === 'carnivore') {
    const P = PONDS[0], inPond = waterDepthAt(d.x, d.z) > 0.3;
    if (!inPond) return { key: 'pond', say: 'Get back in the water', sub: 'You are slow and easy to see on land. The pond is where you hunt.', at: { x: P.x, z: P.z } };
    let herd = null as null | { x: number; z: number }, hd = 30;
    for (const h of w.herbivores) {
      const dist = Math.hypot(h.x - d.x, h.z - d.z);
      if (h.state !== 'dead' && dist < hd) {
        hd = dist;
        herd = h;
      }
    }
    if (herd) return { key: 'ambush', say: 'Ambush at the edge', sub: 'Creep close lying low, then lunge with sprint and hold {eat}: you hold on. Back into deep water and it drowns.', at: herd };
    return { key: 'wait', say: 'Lie in wait', sub: 'Stay still and you sink until only your eyes show. Fish and drinkers come close.', at: null };
  }
  let prey = null as null | { x: number; z: number; name: string }, pd = 70;
  const mass = d.body.mass, mult = d.species.biteMult;
  const consider = (x: number, z: number, m: number, name: string): void => {
    const dist = Math.hypot(x - d.x, z - d.z);
    if (dist < pd && bitesToKill(mass, m, mult) <= OBJ.bites) {
      pd = dist;
      prey = { x, z, name };
    }
  };
  for (const m of w.smalls) if (exposed(m) && (m.kind !== 'fish' || d.species.swim > 0)) consider(m.x, m.z, m.mass, m.kind === 'cynodont' ? 'the small cynodont' : m.kind === 'fish' ? 'a fish' : 'the Exaeretodon');
  for (const h of w.herbivores) if (h.state !== 'dead') consider(h.x, h.z, HYPERODAPEDON.mass, 'a Hyperodapedon');
  const hunt = (): Objective => {
    const p = prey as unknown as { x: number; z: number; name: string };
    return { key: `hunt:${p.name}`, say: `Hunt ${p.name}`, sub: 'Creep up, then hold {eat} as it comes in reach: the jaws close a moment after you press, so lead a running target. A wounded one slows down.', at: p };
  };
  if (prey && pd < OBJ.huntNear) return hunt();
  if (d.species.diet !== 'carnivore' && browseAt(d.x, d.z) > 0.5) return { key: 'browse', say: 'Browse the ferns', sub: 'Hold {eat} to eat the ferns where you stand.', at: null };
  const g = nearestGrub(w, d.x, d.z, now);
  if (g) return { key: 'grubs', say: 'Dig for grubs', sub: 'Little patches of turned earth. Hold {eat} over one to dig it out.', at: g };
  if (prey) return hunt();
  return { key: 'search', say: 'Find food', sub: 'Hold {drink} away from water to sniff the wind for blood and carcasses.', at: null };
}

export function objectiveOf(w: World, slot: PlayerSlot = w.players[0]): Objective | null {
  const d = slot.dino, n = d.needs;
  if (!d.alive) return null;
  if (d.egg > 0) return { key: 'egg', say: 'Hatch', sub: 'Press {go} again and again to tear free of the egg.', at: null };
  for (const s of w.sauros) {
    const dist = Math.hypot(s.x - d.x, s.z - d.z);
    const onYou = s.target === slot.entity && (s.state === 'stalk' || s.state === 'charge');
    // Only a danger to what it would hunt; a full-grown Herrerasaurus is its predator (D20).
    const prey = d.body.mass >= SAUROSUCHUS.minPrey && d.body.mass <= SAUROSUCHUS.mass * SAUROSUCHUS.maxPreyFrac;
    if (onYou || (prey && dist < OBJ.danger && s.state !== 'rest' && s.state !== 'eat' && s.state !== 'flee')) {
      return { key: 'danger', say: 'Saurosuchus! Get away', sub: onYou ? 'It is hunting you. Sprint away, and break its line of sight in the ferns.' : 'Keep your distance and stay downwind of it.', at: null };
    }
  }
  if (n.thirst < OBJ.drinkNow) return { key: 'drinkNow', say: 'Find water, now', sub: 'Thirst kills fastest. Walk to the water and hold {drink}.', at: waterEdge(d.x, d.z) };
  if (n.hunger < OBJ.eatNow) return { ...food(w, slot), key: 'eatNow' };
  if (n.health < OBJ.heal) {
    const fed = n.hunger > 0.5 && n.thirst > 0.5;
    return { key: 'heal', say: 'Rest and heal', sub: fed ? 'You heal while fed and watered. Hold {rest} to lie down somewhere quiet.' : 'You only heal while fed and watered, both above half.', at: null };
  }
  if (n.thirst < OBJ.drink) return { key: 'drink', say: 'Drink at the pond', sub: 'Walk to the water’s edge and hold {drink}.', at: waterEdge(d.x, d.z) };
  if (n.hunger < OBJ.eat) return food(w, slot);
  if (d.stamina < OBJ.tired) return { key: 'tired', say: 'Get your breath back', sub: 'Hold {rest} to lie down. Stamina comes back ten times faster lying down.', at: null };
  if (d.growth < 1) {
    const next = stageOf(Math.min(1, d.growth + 0.001)) === 'hatchling' ? 'a juvenile' : stageOf(d.growth) === 'juvenile' ? 'a sub-adult' : 'an adult';
    return { key: 'grow', say: `Grow into ${next}`, sub: `You grow while fed and watered. Keep both topped up. ${Math.round(d.growth * 100)}% grown.`, at: null };
  }
  const sp = d.species, big = d.body.mass >= SAUROSUCHUS.mass * SAUROSUCHUS.fearFrac;
  if (big) return { key: 'rule', say: 'Rule the valley', sub: 'Fully grown: even Saurosuchus runs from you now. Hunt it, or take down a Hyperodapedon.', at: null };
  if (sp.diet === 'rooter') return { key: 'rule', say: 'Live long', sub: 'Fully grown and armoured. Nothing here hunts an adult aetosaur; keep fed, and lie flat if one tries.', at: null };
  if (sp.swim > 0) return { key: 'rule', say: 'Rule the pond', sub: 'Fully grown. Take what comes to drink, and stay in the water when Saurosuchus is about.', at: null };
  return { key: 'rule', say: 'Stay alive', sub: 'Fully grown, but small. Keep fed and out of sight; everything bigger is a threat.', at: null };
}
