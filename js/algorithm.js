// Outfit ranking. These functions only read the state you pass in —
// no DOM, no Firebase — so the weekly rules can be tested on their own.

export const CATS = ['hijab', 'top', 'bottom', 'shoes'];
export const MIN_PER_CAT = 3;
export const THETA_C = 7;      // comfort threshold for "OP-tier"
export const THETA_A = 7;      // aesthetic threshold for "OP-tier"
export const OP_MAX_PER_WEEK = 2;
export const LAMBDA = 0.15;    // freshness decay rate
export const WEIGHTS = { comfort: 1, aesthetic: 1, freshness: 1, energy: 1 };
export const TOP_BOTTOM_WEEKLY_CAP = 2; // tops/bottoms capped at 2 uses/week; hijab & shoes uncapped

export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

export function itemsByCat(items, cat) {
  return items.filter(i => i.category === cat);
}

export function isSetupComplete(items) {
  return CATS.every(c => itemsByCat(items, c).length >= MIN_PER_CAT);
}

export function findItem(items, id) {
  return items.find(i => i.id === id);
}

export function pairApproved(pairs, topId, bottomId) {
  return pairs.some(p => p.topId === topId && p.bottomId === bottomId && p.approved);
}

export function pairDecided(pairs, topId, bottomId) {
  return pairs.some(p => p.topId === topId && p.bottomId === bottomId);
}

export function trioApproved(trios, topId, bottomId, hijabId) {
  return trios.some(t => t.topId === topId && t.bottomId === bottomId && t.hijabId === hijabId && t.approved);
}

export function trioDecided(trios, topId, bottomId, hijabId) {
  return trios.some(t => t.topId === topId && t.bottomId === bottomId && t.hijabId === hijabId);
}

export function comboExists(outfits, topId, bottomId, hijabId, shoesId) {
  return outfits.some(o => o.topId === topId && o.bottomId === bottomId && o.hijabId === hijabId && o.shoesId === shoesId);
}

// Questions triggered by a newly added item.
export function buildQuizQueueForNewItem(state, newItem) {
  const quizQueue = [];
  const tops = itemsByCat(state.items, 'top');
  const bottoms = itemsByCat(state.items, 'bottom');

  if (newItem.category === 'top') {
    bottoms.forEach(b => {
      if (!pairDecided(state.pairs, newItem.id, b.id)) quizQueue.push({ type: 'pair', topId: newItem.id, bottomId: b.id });
    });
  } else if (newItem.category === 'bottom') {
    tops.forEach(t => {
      if (!pairDecided(state.pairs, t.id, newItem.id)) quizQueue.push({ type: 'pair', topId: t.id, bottomId: newItem.id });
    });
  } else if (newItem.category === 'hijab') {
    state.pairs.filter(p => p.approved).forEach(p => {
      if (!trioDecided(state.trios, p.topId, p.bottomId, newItem.id)) {
        quizQueue.push({ type: 'trio', topId: p.topId, bottomId: p.bottomId, hijabId: newItem.id });
      }
    });
  } else if (newItem.category === 'shoes') {
    state.trios.filter(t => t.approved).forEach(t => {
      if (!comboExists(state.outfits, t.topId, t.bottomId, t.hijabId, newItem.id)) {
        quizQueue.push({ type: 'combo', topId: t.topId, bottomId: t.bottomId, hijabId: t.hijabId, shoesId: newItem.id });
      }
    });
  }
  return quizQueue;
}

// After a pair or trio is approved, chain forward to the next stage.
export function extendQueueAfterApproval(state, step) {
  const extra = [];
  const hijabs = itemsByCat(state.items, 'hijab');
  const shoes = itemsByCat(state.items, 'shoes');
  if (step.type === 'pair') {
    hijabs.forEach(h => {
      if (!trioDecided(state.trios, step.topId, step.bottomId, h.id)) {
        extra.push({ type: 'trio', topId: step.topId, bottomId: step.bottomId, hijabId: h.id });
      }
    });
  } else if (step.type === 'trio') {
    shoes.forEach(s => {
      if (!comboExists(state.outfits, step.topId, step.bottomId, step.hijabId, s.id)) {
        extra.push({ type: 'combo', topId: step.topId, bottomId: step.bottomId, hijabId: step.hijabId, shoesId: s.id });
      }
    });
  }
  return extra;
}

export function wearsThisWeek(wears, date = new Date()) {
  const start = startOfWeek(date);
  return wears.filter(w => new Date(w.date) >= start);
}

export function outfitWornThisWeek(wears, outfitId, date = new Date()) {
  return wearsThisWeek(wears, date).some(w => w.outfitId === outfitId);
}

export function pieceUsesThisWeek(state, itemId, date = new Date()) {
  const outfitIds = new Set(wearsThisWeek(state.wears, date).map(w => w.outfitId));
  let count = 0;
  state.outfits.forEach(o => {
    if (!outfitIds.has(o.id)) return;
    if (o.topId === itemId || o.bottomId === itemId || o.hijabId === itemId || o.shoesId === itemId) count++;
  });
  return count;
}

export function daysSinceWorn(state, itemId, now = new Date()) {
  const wearsForItem = state.wears
    .map(w => ({ ...w, outfit: state.outfits.find(o => o.id === w.outfitId) }))
    .filter(w => w.outfit && [w.outfit.topId, w.outfit.bottomId, w.outfit.hijabId, w.outfit.shoesId].includes(itemId));
  if (wearsForItem.length === 0) return 999; // never worn -> effectively no penalty
  const mostRecent = wearsForItem.reduce((max, w) => new Date(w.date) > new Date(max) ? w.date : max, wearsForItem[0].date);
  return Math.floor((now - new Date(mostRecent)) / (1000 * 60 * 60 * 24));
}

export function outfitComfort(items, outfit) {
  const pieces = [findItem(items, outfit.topId), findItem(items, outfit.bottomId), findItem(items, outfit.hijabId), findItem(items, outfit.shoesId)];
  return pieces.reduce((s, p) => s + (p ? p.comfort : 0), 0) / 4;
}

export function outfitEnergy(items, outfit) {
  const pieces = [findItem(items, outfit.topId), findItem(items, outfit.bottomId), findItem(items, outfit.hijabId), findItem(items, outfit.shoesId)];
  return pieces.reduce((s, p) => s + (p ? p.energy : 0), 0);
}

export function outfitFreshnessPenalty(state, outfit, now = new Date()) {
  const ids = [outfit.topId, outfit.bottomId, outfit.hijabId, outfit.shoesId];
  return ids.reduce((s, id) => s + Math.exp(-LAMBDA * daysSinceWorn(state, id, now)), 0);
}

export function isOPTier(items, outfit) {
  return outfitComfort(items, outfit) >= THETA_C && outfit.aesthetic >= THETA_A;
}

export function opUsedThisWeek(state, date = new Date()) {
  return wearsThisWeek(state.wears, date).filter(w => {
    const outfit = state.outfits.find(x => x.id === w.outfitId);
    return outfit && isOPTier(state.items, outfit);
  }).length;
}

export function candidateOutfits(state, isRaining, date = new Date()) {
  return state.outfits.filter(outfit => {
    const top = findItem(state.items, outfit.topId);
    const bottom = findItem(state.items, outfit.bottomId);
    const hijab = findItem(state.items, outfit.hijabId);
    const shoes = findItem(state.items, outfit.shoesId);
    if (!top || !bottom || !hijab || !shoes) return false;
    if (top.available === false || bottom.available === false || hijab.available === false || shoes.available === false) return false;
    if (isRaining && (bottom.rainSavvy === false || shoes.rainSavvy === false)) return false;
    if (outfitWornThisWeek(state.wears, outfit.id, date)) return false;
    if (pieceUsesThisWeek(state, outfit.topId, date) >= TOP_BOTTOM_WEEKLY_CAP) return false;
    if (pieceUsesThisWeek(state, outfit.bottomId, date) >= TOP_BOTTOM_WEEKLY_CAP) return false;
    return true;
  });
}

export function scoreOutfit(state, outfit, now = new Date()) {
  return WEIGHTS.comfort * outfitComfort(state.items, outfit)
       + WEIGHTS.aesthetic * outfit.aesthetic
       - WEIGHTS.freshness * outfitFreshnessPenalty(state, outfit, now)
       - WEIGHTS.energy * outfitEnergy(state.items, outfit);
}

export function getRankedCandidates(state, isRaining, now = new Date()) {
  let pool = candidateOutfits(state, isRaining, now);
  if (opUsedThisWeek(state, now) >= OP_MAX_PER_WEEK) pool = pool.filter(outfit => !isOPTier(state.items, outfit));
  return pool
    .map(outfit => ({ outfit, score: scoreOutfit(state, outfit, now) }))
    .sort((a, b) => b.score - a.score);
}
