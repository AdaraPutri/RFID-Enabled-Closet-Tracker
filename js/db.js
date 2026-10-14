// Firestore access. Clothes live under users/{uid}/ so each Google account
// has its own closet. Helpers write through to Firestore, then mirror the
// change onto the in-memory state object the rest of the app reads.

export function userCollectionPath(uid, name) {
  return `users/${uid}/${name}`;
}

function col(db, uid, name) {
  return db.collection('users').doc(uid).collection(name);
}

export function createState() {
  return {
    items: [],      // {id, category, photo, comfort, energy, rainSavvy, available, createdAt}
    pairs: [],      // top-bottom: {id, topId, bottomId, approved}
    trios: [],      // {id, topId, bottomId, hijabId, approved}
    outfits: [],    // {id, topId, bottomId, hijabId, shoesId, aesthetic}
    wears: []       // {id, outfitId, date (yyyy-mm-dd)}
  };
}

export async function loadAll(db, uid, state) {
  if (!db || !uid) return;
  const [itemsSnap, pairsSnap, triosSnap, outfitsSnap, wearsSnap] = await Promise.all([
    col(db, uid, 'items').get(),
    col(db, uid, 'pairs').get(),
    col(db, uid, 'trios').get(),
    col(db, uid, 'outfits').get(),
    col(db, uid, 'wears').get()
  ]);
  state.items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.pairs = pairsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.trios = triosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.outfits = outfitsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.wears = wearsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addItem(db, uid, state, data) {
  const ref = await col(db, uid, 'items').add(data);
  state.items.push({ id: ref.id, ...data });
  return ref.id;
}

export async function setPair(db, uid, state, topId, bottomId, approved) {
  const ref = await col(db, uid, 'pairs').add({ topId, bottomId, approved });
  state.pairs.push({ id: ref.id, topId, bottomId, approved });
}

export async function setTrio(db, uid, state, topId, bottomId, hijabId, approved) {
  const ref = await col(db, uid, 'trios').add({ topId, bottomId, hijabId, approved });
  state.trios.push({ id: ref.id, topId, bottomId, hijabId, approved });
}

export async function addOutfit(db, uid, state, topId, bottomId, hijabId, shoesId, aesthetic) {
  const data = { topId, bottomId, hijabId, shoesId, aesthetic };
  const ref = await col(db, uid, 'outfits').add(data);
  state.outfits.push({ id: ref.id, ...data });
}

export async function logWear(db, uid, state, outfitId, date) {
  const data = { outfitId, date };
  const ref = await col(db, uid, 'wears').add(data);
  state.wears.push({ id: ref.id, ...data });
}

export async function updateItemAvailability(db, uid, state, itemId, available) {
  await col(db, uid, 'items').doc(itemId).update({ available });
  const it = state.items.find(i => i.id === itemId);
  if (it) it.available = available;
}

// Pairings, outfits, and wear logs that mention this piece.
// Returned as ids so a delete can remove them together.
export function recordsForDeletedItem(state, itemId) {
  const pairs = state.pairs.filter(p => p.topId === itemId || p.bottomId === itemId);
  const trios = state.trios.filter(t => t.topId === itemId || t.bottomId === itemId || t.hijabId === itemId);
  const outfits = state.outfits.filter(o => [o.topId, o.bottomId, o.hijabId, o.shoesId].includes(itemId));
  const outfitIds = new Set(outfits.map(o => o.id));
  const wears = state.wears.filter(w => outfitIds.has(w.outfitId));
  return {
    pairIds: pairs.map(p => p.id),
    trioIds: trios.map(t => t.id),
    outfitIds: outfits.map(o => o.id),
    wearIds: wears.map(w => w.id)
  };
}

export async function deleteItem(db, uid, state, itemId) {
  const refs = recordsForDeletedItem(state, itemId);
  const batch = db.batch();
  batch.delete(col(db, uid, 'items').doc(itemId));
  for (const id of refs.pairIds) batch.delete(col(db, uid, 'pairs').doc(id));
  for (const id of refs.trioIds) batch.delete(col(db, uid, 'trios').doc(id));
  for (const id of refs.outfitIds) batch.delete(col(db, uid, 'outfits').doc(id));
  for (const id of refs.wearIds) batch.delete(col(db, uid, 'wears').doc(id));
  await batch.commit();

  const pairIds = new Set(refs.pairIds);
  const trioIds = new Set(refs.trioIds);
  const outfitIds = new Set(refs.outfitIds);
  const wearIds = new Set(refs.wearIds);
  state.items = state.items.filter(i => i.id !== itemId);
  state.pairs = state.pairs.filter(p => !pairIds.has(p.id));
  state.trios = state.trios.filter(t => !trioIds.has(t.id));
  state.outfits = state.outfits.filter(o => !outfitIds.has(o.id));
  state.wears = state.wears.filter(w => !wearIds.has(w.id));
}
