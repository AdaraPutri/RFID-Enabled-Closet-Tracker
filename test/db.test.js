import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsForDeletedItem, sameDayWearIds, userCollectionPath } from '../js/db.js';

test('deleting a top drops only the pairings, outfits, and wears that use it', () => {
  const state = {
    items: [{ id: 't' }, { id: 'other' }],
    pairs: [
      { id: 'p1', topId: 't', bottomId: 'b' },
      { id: 'p2', topId: 'other', bottomId: 'b' }
    ],
    trios: [
      { id: 'tr1', topId: 't', bottomId: 'b', hijabId: 'h' },
      { id: 'tr2', topId: 'other', bottomId: 'b', hijabId: 'h' }
    ],
    outfits: [
      { id: 'o1', topId: 't', bottomId: 'b', hijabId: 'h', shoesId: 's' },
      { id: 'o2', topId: 'other', bottomId: 'b', hijabId: 'h', shoesId: 's' }
    ],
    wears: [
      { id: 'w1', outfitId: 'o1', date: '2026-09-30' },
      { id: 'w2', outfitId: 'o2', date: '2026-09-29' }
    ]
  };

  assert.deepEqual(recordsForDeletedItem(state, 't'), {
    pairIds: ['p1'],
    trioIds: ['tr1'],
    outfitIds: ['o1'],
    wearIds: ['w1']
  });
});

test('choosing another outfit for a day replaces the earlier logs for that day', () => {
  const wears = [
    { id: 'w1', outfitId: 'early', date: '2026-10-19' },
    { id: 'w2', outfitId: 'also-early', date: '2026-10-19' },
    { id: 'w3', outfitId: 'other-day', date: '2026-10-18' }
  ];
  assert.deepEqual(sameDayWearIds(wears, '2026-10-19'), ['w1', 'w2']);
});

test('each account has its own closet path', () => {
  assert.equal(userCollectionPath('abc', 'items'), 'users/abc/items');
});

test('a piece with no pairings deletes nothing else', () => {
  const state = { items: [{ id: 't' }], pairs: [], trios: [], outfits: [], wears: [] };
  assert.deepEqual(recordsForDeletedItem(state, 't'), {
    pairIds: [],
    trioIds: [],
    outfitIds: [],
    wearIds: []
  });
});
