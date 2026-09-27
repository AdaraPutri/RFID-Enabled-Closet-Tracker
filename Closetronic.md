# Closetronic

A closet inventory and outfit-suggestion app. It tracks what clothes exist, which ones are currently clean and available, and picks a daily outfit from pre-approved combinations based on comfort, look, freshness, effort, and a set of weekly repeat rules.

Outfit pairing itself is never automated — a human decides which pieces go together. The software's job is entirely downstream of that: given a library of already-approved combos, decide which one makes sense to wear today.

Tech stack: HTML, CSS, vanilla JavaScript, Firebase (Firestore).

This is the outfit generator portion of the project.

---

## Core goal

Decide what to wear in under five minutes. The chosen outfit must:
- be comfortable to wear (low tactile disturbance),
- be suitable for the day's weather,
- not repeat an outfit already worn that week,
- and only use pieces that are currently available (not in the laundry).

Everything else in this document exists to support that.

---

## Closet structure

Four fixed categories, each managed independently:

- **Hijabs**
- **Tops**
- **Bottoms**
- **Shoes**

Each category has its own section in the UI with its own "add" button. There is no category picker when adding an item — the category is already known from which section the add button was tapped in.

**Minimum before anything else works:** at least 3 hijabs, 3 tops, 3 bottoms, and 3 shoes must exist before outfit generation is unlocked. Progress toward this minimum should be visible (e.g. "Tops 2/3").

---

## Adding a clothing item

What's asked depends on the category.

**Hijabs:** instead of uploading a photo, the user picks a color — a hex color picker plus a row of preset swatches. Hijabs are represented by that color swatch everywhere in the app (closet grid, matching quiz, daily suggestion, history) rather than a photo.

**Tops, bottoms, shoes:** the user uploads a photo (ideally transparent background, though not strictly enforced).

**Every category also asks:**
- **Tactile comfort** — a 1–10 rating of how the item physically feels to wear.
- **Energy cost** — how much effort it takes to actually get into the item. Represented as a set of checkboxes (needs ironing, needs tucking in, needs seamless/special underwear, needs a belt, etc.), each contributing points to a summed energy score. This list of checkbox options is expected to grow over time.

**Only bottoms and shoes also ask:**
- **Rain-savvy** — yes/no. Hijabs and tops are not asked this; they're assumed unaffected by rain.

New items default to "available" (clean, in the closet) until manually marked otherwise later.

---

## Matching quiz (building outfits)

Outfit pairing is fully manual — the software never guesses what goes with what. Instead, every time a new item is added, it triggers a chain of yes/no questions against relevant existing items, one at a time, with a green check / red X style choice.

The chain works in stages:

1. **Top ↔ Bottom.** A new top is checked against every existing bottom (and vice versa for a new bottom). Each pairing gets an independent yes/no.
2. **+ Hijab.** Every top+bottom pair that was approved gets checked against every existing hijab: "does this hijab work with this top+bottom pair?"
3. **+ Shoes.** Every top+bottom+hijab combination that was approved gets checked against every existing pair of shoes: "do these shoes work with this trio?"
4. **Aesthetic rating.** The moment a full four-piece chain (hijab + top + bottom + shoes) is approved end-to-end, it becomes a stored **outfit**, and the user is asked one more question: a 1–10 rating of how good the combination looks together. This aesthetic score is a property of the *combo*, independent of the individual pieces' comfort/energy scores.

Adding a **hijab** only triggers questions against existing approved top+bottom pairs (no need to re-ask already-settled top/bottom pairings). Adding **shoes** only triggers questions against existing approved top+bottom+hijab trios. This keeps the quiz scoped to only what's actually new.

Rejected (X) pairings at any stage stop the chain there — a rejected top+bottom pair is never asked about hijabs or shoes. Rejected decisions are stored, not just discarded, so the same pairing isn't asked again automatically. There's an open question on whether rejected pairs should ever resurface later for re-evaluation (e.g. in case taste changes) — not decided yet, currently they stay permanently excluded.

A "manage pairings" view should let the user browse past yes/no decisions and manually flip a rejection to an approval (which should then trigger the next stage's questions for it) or retire a previously-approved combo.

---

## Availability (laundry) tracking

Every item has an available/unavailable status. This is **not** tied to the daily outfit-confirmation flow — asking "is this dirty?" every time an outfit is worn was considered and deliberately rejected, since it doesn't match how laundry actually happens (a few times a week, not daily) and adds friction exactly when the user wants zero friction (getting dressed in the morning).

Instead, availability is its own screen, updated whenever the user wants:
- A grid of all closet items, browsed like a camera roll.
- Tap to select multiple items.
- Two actions: mark selected as available, or mark selected as unavailable.
- Unavailable items are visually dimmed in the grid.

This screen is expected to be opened a couple of times a week, independent of the daily flow entirely.

---

## Weekly repeat rules

These reset every week (Monday–Sunday):

- The exact same outfit (same hijab + top + bottom + shoes) cannot be worn twice in one week.
- Individual tops and bottoms can each be reused up to **2 times** within the week, across any outfit they appear in.
- Hijabs and shoes have **no cap** — they can repeat as often as needed.

This means tracking usage at two levels simultaneously: whether the exact combo has been worn, and how many times each individual top/bottom has appeared in *any* worn outfit that week.

---

## "Don't front-load the best outfits" rule

An outfit is considered **top-tier** if both its average comfort score and its aesthetic score exceed certain thresholds at the same time. A weekly cap limits how many top-tier outfits can be worn in a rolling week — once that cap is hit, remaining top-tier outfits are excluded from that day's options, even if they'd otherwise be valid. The intent is to prevent burning through all the best combinations early in the week and being stuck with worse ones later.

---

## Daily outfit decision

Each day, the app narrows down to a single suggestion using this sequence:

**1. Hard filters** — an outfit is only considered if all of these hold:
- Every piece in it is currently available.
- It matches today's weather (if it's raining, both the bottom and the shoes in the outfit must be rain-savvy; hijab and top are unaffected by rain).
- The exact combo hasn't been worn yet this week.
- Neither its top nor its bottom has already hit the 2-uses-this-week cap.

**2. Top-tier throttle** — if the weekly top-tier cap has already been reached, remove any remaining top-tier outfits from consideration too.

**3. Scoring** — everything that survives gets scored using four factors:
- **Comfort** — average tactile comfort across the four pieces. Averaged, not minimum, since every outfit in the system was already manually approved as wearable — no single decent-but-not-great piece should tank an otherwise good outfit.
- **Aesthetic** — the look rating set when the combo was first approved.
- **Freshness** — how long it's been since the outfit (and its individual pieces) were last worn, with a recency-weighted decay — an outfit worn yesterday is penalized more than one worn three weeks ago, but the penalty fades over time rather than counting flatly.
- **Energy cost** — total effort required across the four pieces, summed (each additional hassle — ironing, tucking, special underwear — genuinely adds friction, so this stacks rather than averages).

These four factors are combined into one score using adjustable weights, so it's possible to tune how much each factor matters relative to the others later.

**4. Output** — the highest-scoring outfit is shown as the day's suggestion. A "show more options" action reveals the next few highest-scoring outfits as a fallback list, in case the top pick isn't wanted that day.

**Confirming an outfit** simply logs it as worn for that date and updates the weekly usage counters — no follow-up questions asked at that point (see the laundry section above for why).

---

## History and planning

- A weekly view (e.g. a 7-day strip) shows what was worn each day, with the ability to tap into a past day for detail.
- A separate "plan the week" mode lets the user manually pre-assign specific outfits to specific upcoming days, ahead of time, overriding the daily algorithm for those days.
- Pre-set outfits still count toward the weekly repeat rules — the algorithm should never suggest something on a non-preset day that would conflict with an outfit already pre-set earlier in the week.

---

## Data model (conceptual)

**Item** (hijab / top / bottom / shoes)
- category
- photo (tops/bottoms/shoes) or color (hijabs)
- tactile comfort (1–10)
- energy cost (summed from checkbox selections)
- rain-savvy (bottoms/shoes only; null/not applicable for hijabs/tops)
- available (boolean, defaults true)

**Pair** (top + bottom matching decision)
- top reference, bottom reference
- approved (boolean)

**Trio** (top + bottom + hijab matching decision)
- top, bottom, hijab references
- approved (boolean)

**Outfit** (a fully approved top + bottom + hijab + shoes chain)
- references to all four pieces
- aesthetic score (1–10)

**Wear** (a logged instance of an outfit being worn on a specific date)
- outfit reference
- date

Weekly usage, freshness, and top-tier throttling are all derived from the Wear log rather than stored as separate running counters, so they stay consistent if past data is ever edited.

---

## UI tone

Kept deliberately plain and minimal — white background, no unnecessary visual flourish. The matching quiz uses a simple red X / green check interaction rather than anything more elaborate. The daily flow is designed to require the fewest possible taps: open the app, see one suggestion, tap "wear this," done.

---

## Explicitly out of scope for this phase

- RFID hardware integration (planned for later — the eventual intent is that item availability could be inferred automatically from RFID reads in a physical closet setup, with manual override still needed to handle missed reads, but this phase is software-only).
- Automated outfit pairing/suggestion of *new* combinations — the software only ranks combos a human has already approved, it never invents pairings on its own.

---

## Open questions not yet resolved

- Should a rejected (X'd) pairing ever be re-offered for reconsideration later, or stay permanently excluded once rejected?
- Exact numeric values for the tuning constants (top-tier thresholds, weekly top-tier cap, freshness decay rate, and the relative weights on comfort/aesthetic/freshness/energy) are placeholders for now and expected to be adjusted based on how the suggestions feel in practice.
