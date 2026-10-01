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
import {
  getSavedConfig,
  saveConfig,
  parseFirebaseConfigInput,
  emptyConfigTemplate
} from './config.js';
import {
  createState,
  loadAll,
  addItem,
  setPair,
  setTrio,
  addOutfit,
  logWear,
  updateItemAvailability
} from './db.js';

const state = createState();
let db = null;
let selectedAvailItems = new Set();
let quizQueue = [];
let isRainingToday = false;

const CAT_LABELS = { hijab: 'Hijabs', top: 'Tops', bottom: 'Bottoms', shoes: 'Shoes' };

const HIJAB_PRESET_COLORS = [
  '#1a1a1a', '#5c4033', '#8a1c1c', '#c0392b', '#e67e22', '#e1b12c',
  '#2e7d32', '#16a085', '#2980b9', '#34495e', '#8e44ad', '#c2185b',
  '#d7bfa6', '#f5f0e8', '#ffffff', '#9e9e9e'
];

// Initializes Firebase with a given config, signs in anonymously, and
// only THEN loads data — fixes the race condition where data fetches
// were firing before the anonymous session existed, which made
// Firestore silently deny the read (looked like "data gone").
async function initFirebase(configObj) {
  const firebase = globalThis.firebase;
  try {
    if (firebase.apps.length) {
      firebase.apps.forEach(a => a.delete());
    }
    firebase.initializeApp(configObj);
    db = firebase.firestore();
    await firebase.auth().signInAnonymously();
    document.getElementById('configWarning').classList.add('hidden');
    await loadAll(db, state);
    renderAll();
  } catch (e) {
    console.error('Firebase init/auth failed', e);
    db = null;
    document.getElementById('configWarning').classList.remove('hidden');
  }
}

function openSettingsModal() {
  const existing = getSavedConfig();
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="overlay" id="ov">
      <div class="modal">
        <h3>Firebase config</h3>
        <p class="help">
          Paste the config object from your Firebase project
          (Project settings → your web app → SDK setup and configuration).
          This is saved only in this browser's local storage — it is never
          written back into the HTML file.
        </p>
        <textarea id="configTextarea" class="config-input" rows="10">${existing ? JSON.stringify(existing, null, 2) : emptyConfigTemplate()}</textarea>
        <div class="modal-actions">
          <button class="btn ghost" id="closeSettings">Close</button>
          <button class="btn primary" id="saveSettings">Save & connect</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('closeSettings').onclick = () => { modalRoot.innerHTML = ''; };
  document.getElementById('ov').addEventListener('click', e => { if (e.target.id === 'ov') modalRoot.innerHTML = ''; });
  document.getElementById('saveSettings').onclick = async () => {
    const rawInput = document.getElementById('configTextarea').value;
    const parsed = parseFirebaseConfigInput(rawInput);
    if (!parsed) {
      alert('Couldn\'t read that as a config object — make sure you copied the whole { ... } block from Firebase\'s "SDK setup and configuration" page.');
      return;
    }
    if (!parsed.apiKey || !parsed.projectId) {
      alert('Config looks incomplete — make sure apiKey and projectId are filled in.');
      return;
    }
    saveConfig(parsed);
    modalRoot.innerHTML = '';
    await initFirebase(parsed);
    renderAll();
  };
}

document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);

const savedConfig = getSavedConfig();
if (savedConfig) {
  initFirebase(savedConfig);
} else {
  document.getElementById('configWarning').classList.remove('hidden');
  openSettingsModal();
}

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
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = `C${item.comfort} · E${item.energy}`;
      card.appendChild(tag);
      grid.appendChild(card);
    });
  });
}

document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => openAddItemModal(btn.dataset.add));
});

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
    if (!db) { alert('Firebase not configured — see the yellow banner at the top.'); return; }
    const newId = await addItem(db, state, data);
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
  if (step.type === 'pair') await setPair(db, state, step.topId, step.bottomId, approved);
  if (step.type === 'trio') await setTrio(db, state, step.topId, step.bottomId, step.hijabId, approved);
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
    await addOutfit(db, state, step.topId, step.bottomId, step.hijabId, step.shoesId, aesthetic);
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
        <button class="btn ghost" id="showMoreBtn">Show more options</button>
      </div>
    </div>
    <div class="fallback-list hidden" id="fallbackList"></div>
  `;

  document.getElementById('wearThisBtn').onclick = async () => {
    await logWear(db, state, best.outfit.id, toDateStr(new Date()));
    renderDaily();
    renderHistory();
  };
  document.getElementById('showMoreBtn').onclick = () => {
    const list = document.getElementById('fallbackList');
    list.classList.remove('hidden');
    list.innerHTML = ranked.slice(0, 5).map(r => `
      <div class="outfit-row" data-id="${r.outfit.id}">
        ${outfitImgs(r.outfit)}
        <span class="score">${r.score.toFixed(1)}</span>
      </div>
    `).join('');
    list.querySelectorAll('.outfit-row').forEach(row => {
      row.onclick = async () => {
        await logWear(db, state, row.dataset.id, toDateStr(new Date()));
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
  for (const id of selectedAvailItems) await updateItemAvailability(db, state, id, true);
  renderAvailability();
  renderCloset();
};
document.getElementById('markUnavailable').onclick = async () => {
  for (const id of selectedAvailItems) await updateItemAvailability(db, state, id, false);
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
      await logWear(db, state, row.dataset.id, dateStr);
      renderPlan();
      renderHistory();
    };
  });
}

function renderAll() {
  renderCloset();
  renderDaily();
}
