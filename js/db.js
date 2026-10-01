// Firestore access. Each helper writes through to Firestore, then mirrors
// the change onto the in-memory state object the rest of the app reads.

export function createState() {
  return {
    items: [],      // {id, category, photo, comfort, energy, rainSavvy, available, createdAt}
    pairs: [],      // top-bottom: {id, topId, bottomId, approved}
    trios: [],      // {id, topId, bottomId, hijabId, approved}
    outfits: [],    // {id, topId, bottomId, hijabId, shoesId, aesthetic}
    wears: []       // {id, outfitId, date (yyyy-mm-dd)}
  };
}

export async function loadAll(db, state) {
  if (!db) return;
  const [itemsSnap, pairsSnap, triosSnap, outfitsSnap, wearsSnap] = await Promise.all([
    db.collection('items').get(),
    db.collection('pairs').get(),
    db.collection('trios').get(),
    db.collection('outfits').get(),
    db.collection('wears').get()
  ]);
  state.items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.pairs = pairsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.trios = triosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.outfits = outfitsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.wears = wearsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addItem(db, state, data) {
  const ref = await db.collection('items').add(data);
  state.items.push({ id: ref.id, ...data });
  return ref.id;
}

export async function setPair(db, state, topId, bottomId, approved) {
  const ref = await db.collection('pairs').add({ topId, bottomId, approved });
  state.pairs.push({ id: ref.id, topId, bottomId, approved });
}

export async function setTrio(db, state, topId, bottomId, hijabId, approved) {
  const ref = await db.collection('trios').add({ topId, bottomId, hijabId, approved });
  state.trios.push({ id: ref.id, topId, bottomId, hijabId, approved });
}

export async function addOutfit(db, state, topId, bottomId, hijabId, shoesId, aesthetic) {
  const data = { topId, bottomId, hijabId, shoesId, aesthetic };
  const ref = await db.collection('outfits').add(data);
  state.outfits.push({ id: ref.id, ...data });
}

export async function logWear(db, state, outfitId, date) {
  const data = { outfitId, date };
  const ref = await db.collection('wears').add(data);
  state.wears.push({ id: ref.id, ...data });
}

export async function updateItemAvailability(db, state, itemId, available) {
  await db.collection('items').doc(itemId).update({ available });
  const it = state.items.find(i => i.id === itemId);
  if (it) it.available = available;
}
