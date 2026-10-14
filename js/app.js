// Tabs, modals, and event wiring. Ranking lives in algorithm.js;
// Firestore reads and writes live in db.js.

import {
  CATS,
  MIN_PER_CAT,
  itemsByCat,
  isSetupComplete,
  findItem,
  buildQuizQueueForNewItem,
  extendQueueAfterApproval,
  toDateStr,
  startOfWeek,
  outfitWornThisWeek,
  getRankedCandidates
} from './algorithm.js';
import { getSavedConfig } from './config.js';
import {
  createState,
  loadAll,
  addItem,
  setPair,
  setTrio,
  addOutfit,
  logWear,
  updateItemAvailability,
  deleteItem
} from './db.js';

const state = createState();
let db = null;
let uid = null;
let selectedAvailItems = new Set();
let quizQueue = [];
let isRainingToday = false;

const CAT_LABELS = { hijab: 'Hijabs', top: 'Tops', bottom: 'Bottoms', shoes: 'Shoes' };

const HIJAB_PRESET_COLORS = [
  '#1a1a1a', '#5c4033', '#8a1c1c', '#c0392b', '#e67e22', '#e1b12c',
  '#2e7d32', '#16a085', '#2980b9', '#34495e', '#8e44ad', '#c2185b',
  '#d7bfa6', '#f5f0e8', '#ffffff', '#9e9e9e'
];

function resetState() {
  const fresh = createState();
  for (const key of Object.keys(fresh)) state[key] = fresh[key];
  selectedAvailItems.clear();
  quizQueue = [];
}

function showSignedOut() {
  document.getElementById('signedOut').classList.remove('hidden');
  document.getElementById('appMain').classList.add('hidden');
  document.getElementById('nav').classList.add('hidden');
  document.getElementById('signOutBtn').classList.add('hidden');
  document.getElementById('accountLabel').classList.add('hidden');
  document.getElementById('modalRoot').innerHTML = '';
}

function showSignedIn(user) {
  document.getElementById('signedOut').classList.add('hidden');
  document.getElementById('authError').classList.add('hidden');
  document.getElementById('appMain').classList.remove('hidden');
  document.getElementById('nav').classList.remove('hidden');
  document.getElementById('signOutBtn').classList.remove('hidden');
  const label = document.getElementById('accountLabel');
  label.textContent = user.email || 'Signed in';
  label.classList.remove('hidden');
}

function showAuthError(message) {
  const errEl = document.getElementById('authError');
  errEl.textContent = message;
  errEl.classList.remove('hidden');
}

const firebaseApp = globalThis.firebase;
let googleProvider = null;
let firebaseReady = null;

function configForThisSite(config) {
  const next = { ...config };
  if (!next.databaseURL) delete next.databaseURL;
  const host = location.hostname;
  // The hosted page and the Google handoff have to be the same site.
  // Otherwise the sign-in window can close and the button looks dead.
  if (host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')) {
    next.authDomain = host;
  }
  return next;
}

function loadHostedInitScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://closetronic.web.app/__/firebase/init.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Firebase config failed to load'));
    document.head.appendChild(script);
  });
}

async function loadFirebaseConfig() {
  try {
    const res = await fetch('/__/firebase/init.json');
    if (res.ok) {
      const config = await res.json();
      if (config && config.apiKey && config.projectId) return config;
    }
  } catch (e) {}
  const saved = getSavedConfig();
  if (saved && saved.apiKey && saved.projectId) return saved;
  return null;
}

function ensureFirebase() {
  if (!firebaseReady) firebaseReady = startFirebase();
  return firebaseReady;
}

async function startFirebase() {
  if (!firebaseApp.apps.length) {
    const config = await loadFirebaseConfig();
    if (config) firebaseApp.initializeApp(configForThisSite(config));
    else {
      try { await loadHostedInitScript(); } catch (e) {}
    }
  }
  if (!firebaseApp.apps.length) return false;
  db = firebaseApp.firestore();
  googleProvider = new firebaseApp.auth.GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
  return true;
}

function authFailureMessage(error) {
  if (error && error.code === 'auth/operation-not-allowed') {
    return 'Google sign-in still needs to be turned on in the Firebase project (Authentication → Sign-in method → Google).';
  }
  if (error && error.code === 'auth/unauthorized-domain') {
    return 'This website is not on the Firebase authorized domains list yet.';
  }
  if (error && error.code === 'auth/popup-closed-by-user') {
    return 'Google sign-in closed before it finished. Try again.';
  }
  if (error && error.code === 'auth/popup-blocked') {
    return 'The browser blocked the Google window.';
  }
  return 'Couldn\'t sign in with Google. Try again in a moment.';
}

document.getElementById('googleSignIn').addEventListener('click', async () => {
  const button = document.getElementById('googleSignIn');
  button.disabled = true;
  button.textContent = 'Opening Google…';
  try {
    const ready = await ensureFirebase();
    if (!ready) {
      showAuthError('This browser does not have the Firebase project config, so Google sign-in cannot start.');
      return;
    }
    try {
      await firebaseApp.auth().signInWithPopup(googleProvider);
    } catch (e) {
      if (e.code === 'auth/cancelled-popup-request') return;
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        showAuthError('Opening Google in this tab…');
        await firebaseApp.auth().signInWithRedirect(googleProvider);
        return;
      }
      console.error('Google sign-in failed', e);
      showAuthError(authFailureMessage(e));
    }
  } catch (e) {
    console.error('Google sign-in failed', e);
    showAuthError(authFailureMessage(e));
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in with Google';
  }
});

document.getElementById('signOutBtn').addEventListener('click', () => {
  if (firebaseApp.apps.length) firebaseApp.auth().signOut();
});

ensureFirebase().then(async (ready) => {
  if (!ready) {
    showAuthError('This browser does not have the Firebase project config, so Google sign-in cannot start.');
    return;
  }
  try {
    await firebaseApp.auth().getRedirectResult();
  } catch (e) {
    console.error('Google redirect sign-in failed', e);
    showAuthError(authFailureMessage(e));
  }
  firebaseApp.auth().onAuthStateChanged(async (user) => {
  // The previous version signed everyone in anonymously. That session is
  // still saved in this browser, and it is not a Google account.
  if (user && user.isAnonymous) {
    await firebaseApp.auth().signOut();
    return;
  }
  if (!user) {
    uid = null;
    resetState();
    showSignedOut();
    return;
  }
  uid = user.uid;
  try {
    await loadAll(db, uid, state);
    showSignedIn(user);
    renderAll();
  } catch (e) {
    console.error('Loading closet failed', e);
    showSignedIn(user);
    showAuthError('Signed in, but the closet could not be loaded.');
    document.getElementById('signedOut').classList.remove('hidden');
  }
  });
});

function fileToResizedDataURL(file, maxDim = 300) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png', 0.85));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  document.querySelectorAll('#nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  if (btn.dataset.tab === 'daily') renderDaily();
  if (btn.dataset.tab === 'availability') renderAvailability();
  if (btn.dataset.tab === 'history') renderHistory();
  if (btn.dataset.tab === 'plan') renderPlan();
});

function renderCloset() {
  const progress = document.getElementById('setupProgress');
  progress.innerHTML = '';
  CATS.forEach(cat => {
    const n = itemsByCat(state.items, cat).length;
    const chip = document.createElement('div');
    chip.className = 'setup-chip' + (n >= MIN_PER_CAT ? ' done' : '');
    chip.textContent = `${CAT_LABELS[cat]} ${Math.min(n, MIN_PER_CAT)}/${MIN_PER_CAT}`;
    progress.appendChild(chip);
  });
  document.getElementById('lockedBanner').classList.toggle('hidden', isSetupComplete(state.items));

  CATS.forEach(cat => {
    const grid = document.getElementById('grid-' + cat);
    grid.innerHTML = '';
    itemsByCat(state.items, cat).forEach(item => {
      const card = document.createElement('div');
      card.className = 'item-card' + (item.available === false ? ' unavailable' : '');
      card.innerHTML = pieceVisual(item);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete-piece';
      del.setAttribute('aria-label', `Delete ${item.category}`);
      del.textContent = '×';
      del.addEventListener('click', () => openDeleteItemModal(item));
      card.appendChild(del);
      grid.appendChild(card);
    });
  });
}

document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => openAddItemModal(btn.dataset.add));
});

function openDeleteItemModal(item) {
  const modalRoot = document.getElementById('modalRoot');
  const label = item.category === 'shoes' ? 'shoes' : item.category;
  modalRoot.innerHTML = `
    <div class="overlay" id="ov">
      <div class="modal">
        <h3>Delete this ${label}?</h3>
        <div class="delete-preview">${pieceVisual(item)}</div>
        <p class="help">This also removes pairings and outfits that use it. Wear history for those outfits goes with them.</p>
        <div class="modal-actions">
          <button class="btn ghost" id="cancelDelete">Cancel</button>
          <button class="btn danger" id="confirmDelete">Delete</button>
        </div>
      </div>
    </div>
  `;
  const close = () => { modalRoot.innerHTML = ''; };
  document.getElementById('cancelDelete').onclick = close;
  document.getElementById('ov').addEventListener('click', e => { if (e.target.id === 'ov') close(); });
  document.getElementById('confirmDelete').onclick = async () => {
    if (!db || !uid) { alert('Sign in with Google first.'); return; }
    const btn = document.getElementById('confirmDelete');
    btn.disabled = true;
    try {
      await deleteItem(db, uid, state, item.id);
      quizQueue = quizQueue.filter(step => ![step.topId, step.bottomId, step.hijabId, step.shoesId].includes(item.id));
      selectedAvailItems.delete(item.id);
      close();
      renderAll();
    } catch (e) {
      console.error('Delete failed', e);
      alert('Couldn\'t delete that piece. Check your connection and try again.');
      btn.disabled = false;
    }
  };
}

function openAddItemModal(category) {
  const showRain = category === 'bottom' || category === 'shoes';
  const isHijab = category === 'hijab';
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="overlay" id="ov">
      <div class="modal">
        <h3>Add ${category}</h3>
        ${isHijab ? `
        <label class="field">Color</label>
        <div class="color-picker-row">
          <input type="color" id="colorInput" value="#2980b9">
          <div class="color-preview" id="colorPreview" style="background:#2980b9;"></div>
        </div>
        <div class="swatch-strip" id="presetSwatches">
          ${HIJAB_PRESET_COLORS.map(c => `<div class="sw" data-color="${c}" style="background:${c};"></div>`).join('')}
        </div>
        ` : `
        <div class="file-drop" id="dropZone">
          <div id="dropLabel">Tap to upload photo</div>
          <input type="file" id="fileInput" class="file-input" accept="image/*">
        </div>
        `}
        <label class="field">Tactile comfort — how it feels on skin</label>
        <input type="range" min="1" max="10" value="5" id="comfortRange">
        <div class="range-readout"><span id="comfortVal">5</span>/10</div>

        <label class="field">Energy cost — what it takes to wear</label>
        <div id="energyChecks">
          <div class="checkbox-row"><input type="checkbox" value="2" class="ec"> Needs ironing</div>
          <div class="checkbox-row"><input type="checkbox" value="1" class="ec"> Needs tucking in</div>
          <div class="checkbox-row"><input type="checkbox" value="2" class="ec"> Needs seamless/special underwear</div>
          <div class="checkbox-row"><input type="checkbox" value="1" class="ec"> Needs a belt</div>
        </div>

        ${showRain ? `
        <label class="field">Rain-savvy?</label>
        <div class="toggle-row">
          <button type="button" class="rsBtn" data-val="false">No</button>
          <button type="button" class="rsBtn selected" data-val="true">Yes</button>
        </div>` : ''}

        <div class="modal-actions">
          <button class="btn ghost" id="cancelAdd">Cancel</button>
          <button class="btn primary" id="saveAdd">Add</button>
        </div>
      </div>
    </div>
  `;

  let photoData = null;
  let colorData = isHijab ? '#2980b9' : null;

  if (isHijab) {
    const colorInput = document.getElementById('colorInput');
    const colorPreview = document.getElementById('colorPreview');
    colorInput.addEventListener('input', () => {
      colorData = colorInput.value;
      colorPreview.style.background = colorData;
    });
    document.querySelectorAll('#presetSwatches .sw').forEach(sw => {
      sw.addEventListener('click', () => {
        colorData = sw.dataset.color;
        colorInput.value = colorData;
        colorPreview.style.background = colorData;
      });
    });
  } else {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files[0]) return;
      photoData = await fileToResizedDataURL(fileInput.files[0]);
      document.getElementById('dropLabel').innerHTML = `Photo selected <br><img src="${photoData}">`;
    });
  }

  document.getElementById('comfortRange').addEventListener('input', e => {
    document.getElementById('comfortVal').textContent = e.target.value;
  });

  let rainSavvy = true;
  document.querySelectorAll('.rsBtn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.rsBtn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      rainSavvy = b.dataset.val === 'true';
    });
  });

  document.getElementById('cancelAdd').onclick = () => { modalRoot.innerHTML = ''; };
  document.getElementById('ov').addEventListener('click', e => { if (e.target.id === 'ov') modalRoot.innerHTML = ''; });

  document.getElementById('saveAdd').onclick = async () => {
    const comfort = parseInt(document.getElementById('comfortRange').value, 10);
    const energy = Array.from(document.querySelectorAll('.ec:checked')).reduce((s, c) => s + parseInt(c.value, 10), 0);
    const data = {
      category,
      photo: isHijab ? null : photoData,
      color: isHijab ? colorData : null,
      comfort,
      energy,
      rainSavvy: showRain ? rainSavvy : null,
      available: true,
      createdAt: Date.now()
    };
    if (!db || !uid) { alert('Sign in with Google first.'); return; }
    const newId = await addItem(db, uid, state, data);
    modalRoot.innerHTML = '';
    renderCloset();
    quizQueue = buildQuizQueueForNewItem(state, { id: newId, ...data });
    runNextQuizStep();
  };
}

// Hijabs are represented by a color swatch; everything else by an uploaded photo.
function pieceVisual(item, extraClass = '') {
  if (!item) return '';
  if (item.category === 'hijab') {
    return `<div class="swatch ${extraClass}" style="background:${item.color || '#ccc'};"></div>`;
  }
  return item.photo ? `<img class="${extraClass}" src="${item.photo}">` : `<div class="ph ${extraClass}">no photo</div>`;
}

async function runNextQuizStep() {
  const modalRoot = document.getElementById('modalRoot');
  if (quizQueue.length === 0) { modalRoot.innerHTML = ''; return; }
  const step = quizQueue.shift();

  let pieces = [];
  if (step.type === 'pair') pieces = [findItem(state.items, step.topId), findItem(state.items, step.bottomId)];
  if (step.type === 'trio') pieces = [findItem(state.items, step.topId), findItem(state.items, step.bottomId), findItem(state.items, step.hijabId)];
  if (step.type === 'combo') pieces = [findItem(state.items, step.topId), findItem(state.items, step.bottomId), findItem(state.items, step.hijabId), findItem(state.items, step.shoesId)];

  if (pieces.some(p => !p)) { runNextQuizStep(); return; }

  modalRoot.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>${step.type === 'pair' ? 'Good pair?' : step.type === 'trio' ? 'Add this hijab?' : 'Add these shoes?'}</h3>
        <div class="quiz-pair">
          ${pieces.map(p => `<div class="piece">${pieceVisual(p)}</div>`).join('<div class="quiz-plus">+</div>')}
        </div>
        <div class="quiz-buttons">
          <button class="no" id="quizNo">✕</button>
          <button class="yes" id="quizYes">✓</button>
        </div>
        <div class="quiz-progress">${quizQueue.length} more question${quizQueue.length === 1 ? '' : 's'} after this</div>
      </div>
    </div>
  `;

  document.getElementById('quizNo').onclick = async () => {
    await recordQuizDecision(step, false);
    runNextQuizStep();
  };
  document.getElementById('quizYes').onclick = async () => {
    await recordQuizDecision(step, true);
    if (step.type === 'combo') {
      promptAestheticRating(step);
      return;
    }
    quizQueue.push(...extendQueueAfterApproval(state, step));
    runNextQuizStep();
  };
}

async function recordQuizDecision(step, approved) {
  if (step.type === 'pair') await setPair(db, uid, state, step.topId, step.bottomId, approved);
  if (step.type === 'trio') await setTrio(db, uid, state, step.topId, step.bottomId, step.hijabId, approved);
}

function promptAestheticRating(step) {
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h3>How good does this look together?</h3>
        <input type="range" min="1" max="10" value="7" id="aestheticRange">
        <div class="range-readout"><span id="aestheticVal">7</span>/10</div>
        <div class="modal-actions">
          <button class="btn primary" id="saveAesthetic">Save outfit</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('aestheticRange').addEventListener('input', e => {
    document.getElementById('aestheticVal').textContent = e.target.value;
  });
  document.getElementById('saveAesthetic').onclick = async () => {
    const aesthetic = parseInt(document.getElementById('aestheticRange').value, 10);
    await addOutfit(db, uid, state, step.topId, step.bottomId, step.hijabId, step.shoesId, aesthetic);
    runNextQuizStep();
  };
}

document.getElementById('rainNo').onclick = () => { isRainingToday = false; toggleRainBtns(); renderDaily(); };
document.getElementById('rainYes').onclick = () => { isRainingToday = true; toggleRainBtns(); renderDaily(); };
function toggleRainBtns() {
  document.getElementById('rainNo').classList.toggle('selected', !isRainingToday);
  document.getElementById('rainYes').classList.toggle('selected', isRainingToday);
}

function outfitImgs(outfit) {
  return [outfit.hijabId, outfit.topId, outfit.bottomId, outfit.shoesId].map(id => findItem(state.items, id)).filter(Boolean)
    .map(p => pieceVisual(p)).join('');
}

function renderDaily() {
  const el = document.getElementById('dailyContent');
  if (!isSetupComplete(state.items)) {
    el.innerHTML = `<div class="no-outfit">Finish setup first — add at least 3 of each piece.</div>`;
    return;
  }
  const ranked = getRankedCandidates(state, isRainingToday);
  if (ranked.length === 0) {
    el.innerHTML = `<div class="no-outfit">No valid outfits left for today under this week's rules. Check Availability or approve more combos.</div>`;
    return;
  }

  const best = ranked[0];
  el.innerHTML = `
    <div class="daily-card">
      <div class="daily-pieces">${outfitImgs(best.outfit)}</div>
      <div class="daily-score">score ${best.score.toFixed(1)}</div>
      <button class="btn primary" id="wearThisBtn">Wear this</button>
      <div class="daily-more">
        <button class="btn ghost" id="showMoreBtn">Show all ${ranked.length} option${ranked.length === 1 ? '' : 's'}</button>
      </div>
    </div>
    <div class="fallback-list hidden" id="fallbackList"></div>
  `;

  document.getElementById('wearThisBtn').onclick = async () => {
    await logWear(db, uid, state, best.outfit.id, toDateStr(new Date()));
    renderDaily();
    renderHistory();
  };
  document.getElementById('showMoreBtn').onclick = () => {
    const list = document.getElementById('fallbackList');
    list.classList.remove('hidden');
    list.innerHTML = ranked.map(r => `
      <div class="outfit-row" data-id="${r.outfit.id}">
        ${outfitImgs(r.outfit)}
        <span class="score">${r.score.toFixed(1)}</span>
      </div>
    `).join('');
    list.querySelectorAll('.outfit-row').forEach(row => {
      row.onclick = async () => {
        await logWear(db, uid, state, row.dataset.id, toDateStr(new Date()));
        renderDaily();
        renderHistory();
      };
    });
  };
}

function renderAvailability() {
  const grid = document.getElementById('availGrid');
  selectedAvailItems.clear();
  grid.innerHTML = CATS.map(cat => `
    <div class="section-block">
      <div class="section-title"><h2>${CAT_LABELS[cat]}</h2></div>
      <div class="item-grid" id="avgrid-${cat}"></div>
    </div>
  `).join('');

  CATS.forEach(cat => {
    const g = document.getElementById('avgrid-' + cat);
    itemsByCat(state.items, cat).forEach(item => {
      const card = document.createElement('div');
      card.className = 'item-card' + (item.available === false ? ' unavailable' : '');
      card.dataset.id = item.id;
      card.innerHTML = pieceVisual(item);
      card.onclick = () => {
        if (selectedAvailItems.has(item.id)) { selectedAvailItems.delete(item.id); card.classList.remove('selected'); }
        else { selectedAvailItems.add(item.id); card.classList.add('selected'); }
      };
      g.appendChild(card);
    });
  });
}

document.getElementById('markAvailable').onclick = async () => {
  for (const id of selectedAvailItems) await updateItemAvailability(db, uid, state, id, true);
  renderAvailability();
  renderCloset();
};
document.getElementById('markUnavailable').onclick = async () => {
  for (const id of selectedAvailItems) await updateItemAvailability(db, uid, state, id, false);
  renderAvailability();
  renderCloset();
};

function renderHistory() {
  const start = startOfWeek();
  const strip = document.getElementById('weekStrip');
  strip.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);
    const wear = state.wears.find(w => w.date === dateStr);
    const outfit = wear ? state.outfits.find(o => o.id === wear.outfitId) : null;
    const chip = document.createElement('div');
    chip.className = 'day-chip' + (outfit ? '' : ' empty');
    chip.innerHTML = `<div class="d">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>` +
      (outfit ? `<img src="${findItem(state.items, outfit.topId)?.photo || ''}">` : 'not set');
    chip.onclick = () => {
      const detail = document.getElementById('historyDetail');
      detail.innerHTML = outfit
        ? `<div class="daily-pieces">${outfitImgs(outfit)}</div>`
        : `<div class="no-outfit">Nothing logged for ${dateStr}.</div>`;
    };
    strip.appendChild(chip);
  }
}

function renderPlan() {
  const start = startOfWeek();
  const strip = document.getElementById('planStrip');
  strip.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);
    const wear = state.wears.find(w => w.date === dateStr);
    const chip = document.createElement('div');
    chip.className = 'day-chip' + (wear ? '' : ' empty');
    chip.innerHTML = `<div class="d">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div>` + (wear ? '✓ set' : 'tap to set');
    chip.onclick = () => openPlanPickerForDate(dateStr);
    strip.appendChild(chip);
  }
}

function openPlanPickerForDate(dateStr) {
  const picker = document.getElementById('planPicker');
  const options = state.outfits.filter(o => !outfitWornThisWeek(state.wears, o.id) || state.wears.some(w => w.date === dateStr && w.outfitId === o.id));
  picker.innerHTML = `<h3 class="picker-title">Pick outfit for ${dateStr}</h3>` + options.map(o => `
    <div class="outfit-row" data-id="${o.id}">${outfitImgs(o)}<span class="score">${o.aesthetic}/10 look</span></div>
  `).join('');
  picker.querySelectorAll('.outfit-row').forEach(row => {
    row.onclick = async () => {
      await logWear(db, uid, state, row.dataset.id, dateStr);
      renderPlan();
      renderHistory();
    };
  });
}

function renderAll() {
  renderCloset();
  renderDaily();
}
