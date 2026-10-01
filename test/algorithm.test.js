import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfWeek,
  isSetupComplete,
  buildQuizQueueForNewItem,
  extendQueueAfterApproval,
  candidateOutfits,
  getRankedCandidates,
  daysSinceWorn
} from '../js/algorithm.js';

const NOW = new Date(2026, 8, 30, 12, 0, 0); // Wednesday

function item(partial) {
  return {
    category: 'top',
    comfort: 8,
    energy: 1,
    available: true,
    rainSavvy: true,
    ...partial
  };
}

function closet() {
  return [
    item({ id: 'h', category: 'hijab', energy: 0 }),
    item({ id: 't', category: 'top' }),
    item({ id: 'b', category: 'bottom', rainSavvy: false }),
    item({ id: 's', category: 'shoes', energy: 0, rainSavvy: true })
  ];
}

function outfit(partial) {
  return {
    id: 'o1',
    topId: 't',
    bottomId: 'b',
    hijabId: 'h',
    shoesId: 's',
    aesthetic: 9,
    ...partial
  };
}

function state(partial) {
  return {
    items: closet(),
    pairs: [],
    trios: [],
    outfits: [outfit()],
    wears: [],
    ...partial
  };
}

test('week starts on Monday', () => {
  const start = startOfWeek(NOW);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 28);
});

test('setup needs 3 of each category', () => {
  assert.equal(isSetupComplete(closet()), false);
  const ready = [];
  for (const category of ['hijab', 'top', 'bottom', 'shoes']) {
    for (let i = 0; i < 3; i++) ready.push(item({ id: `${category}${i}`, category }));
  }
  assert.equal(isSetupComplete(ready), true);
});

test('a new top asks about every bottom that has not been decided', () => {
  const closetState = state({
    items: [
      ...closet(),
      item({ id: 'b2', category: 'bottom' })
    ],
    pairs: [{ id: 'p1', topId: 't-new', bottomId: 'b', approved: false }]
  });
  const queue = buildQuizQueueForNewItem(closetState, { id: 't-new', category: 'top' });
  assert.deepEqual(queue, [{ type: 'pair', topId: 't-new', bottomId: 'b2' }]);
});

test('approving a pair queues a trio for each hijab', () => {
  const extra = extendQueueAfterApproval(state(), { type: 'pair', topId: 't', bottomId: 'b' });
  assert.deepEqual(extra, [{ type: 'trio', topId: 't', bottomId: 'b', hijabId: 'h' }]);
});

test('rain, laundry, and a repeat this week drop an outfit', () => {
  const base = state();
  assert.equal(candidateOutfits(base, false, NOW).length, 1);
  assert.equal(candidateOutfits(base, true, NOW).length, 0);

  base.items.find(i => i.id === 't').available = false;
  assert.equal(candidateOutfits(base, false, NOW).length, 0);

  base.items.find(i => i.id === 't').available = true;
  base.wears = [{ id: 'w1', outfitId: 'o1', date: '2026-09-30' }];
  assert.equal(candidateOutfits(base, false, NOW).length, 0);
});

test('a top worn twice this week is capped', () => {
  const capped = state({
    items: [
      ...closet(),
      item({ id: 'b2', category: 'bottom' }),
      item({ id: 'b3', category: 'bottom' })
    ],
    outfits: [
      outfit({ id: 'o1', bottomId: 'b' }),
      outfit({ id: 'o2', bottomId: 'b2' }),
      outfit({ id: 'o3', bottomId: 'b3' })
    ],
    wears: [
      { id: 'w1', outfitId: 'o1', date: '2026-09-29' },
      { id: 'w2', outfitId: 'o2', date: '2026-09-30' }
    ]
  });
  assert.deepEqual(candidateOutfits(capped, false, NOW).map(o => o.id), []);
});

test('after two OP outfits, only a non-OP outfit remains', () => {
  const ranked = state({
    items: [
      ...closet(),
      item({ id: 'b2', category: 'bottom', comfort: 2, rainSavvy: true }),
      item({ id: 't2', category: 'top', comfort: 8 }),
      item({ id: 'b3', category: 'bottom', comfort: 8, rainSavvy: true })
    ],
    outfits: [
      outfit({ id: 'op1', aesthetic: 9 }),
      outfit({ id: 'op2', topId: 't2', bottomId: 'b3', aesthetic: 9 }),
      outfit({ id: 'plain', bottomId: 'b2', aesthetic: 3 })
    ],
    wears: [
      { id: 'w1', outfitId: 'op1', date: '2026-09-29' },
      { id: 'w2', outfitId: 'op2', date: '2026-09-30' }
    ]
  });
  // op1 and op2 are already worn, so they are out. plain is not OP-tier.
  // Add a third OP outfit that has not been worn; the weekly cap should hide it.
  ranked.outfits.push(outfit({ id: 'op3', topId: 't2', bottomId: 'b', aesthetic: 10 }));
  const result = getRankedCandidates(ranked, false, NOW);
  assert.deepEqual(result.map(r => r.outfit.id), ['plain']);
});

test('a higher-looking outfit ranks first when nothing else differs', () => {
  const ranked = state({
    items: [
      ...closet(),
      item({ id: 'b2', category: 'bottom', rainSavvy: true })
    ],
    outfits: [
      outfit({ id: 'low', aesthetic: 4 }),
      outfit({ id: 'high', bottomId: 'b2', aesthetic: 9 })
    ]
  });
  const result = getRankedCandidates(ranked, false, NOW);
  assert.equal(result[0].outfit.id, 'high');
  assert.ok(result[0].score > result[1].score);
});

test('a piece that has never been worn has no freshness penalty', () => {
  assert.equal(daysSinceWorn(state(), 't', NOW), 999);
});
