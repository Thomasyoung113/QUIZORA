# QUIZORA Question Bank Accuracy Audit — 2026-09-01

Sample: 200 random questions (5 offset windows × 40, service-role read only — no DB writes).

## Verdicts

- **OK: 187 (93.5%)**
- **WRONG: 0**
- **AMBIGUOUS: 13 (6.5%)**

## Per-category

| Category | Total | OK | Ambiguous |
|---|---|---|---|
| Logic | 65 | 61 | 4 |
| General Knowledge | 41 | 36 | 5 |
| Science | 28 | 27 | 1 |
| Technology | 10 | 9 | 1 |
| Space | 19 | 18 | 1 |
| Geography | 16 | 16 | 0 |
| History | 17 | 16 | 1 |
| Business | 4 | 4 | 0 |

## Flagged items (all AMBIGUOUS — multiple defensible answers or wording traps)

| id | cat | question | marked | why |
|---|---|---|---|---|
| 538c9432 | Logic | What can you hold in your left hand but not in your right ha | B | Classic answer is 'your right elbow', but 'your right hand' is also impossible to hold in your right hand; D uses elbow  |
| 0599753c | Logic | What number completes this sequence? 0, 6, 24, 60, 120, ? | C | 0,6,24,60,120 = n³−n; next 210 (C, correct) — but 720 (6!) also a common pattern guess; options don't include it, so acc |
| 20a5ed97 | General Knowledge | Including its overseas territories, which country covers the | C | France (12-13 TZ with territories) vs Russia (11) vs US (11-12) — France is the intended answer and defensible, but coun |
| 724783ed | General Knowledge | Which metallic element is liquid at a standard room temperat | B | Mercury is correct, but gallium (melts ~29.8 °C) is near-room-temperature at warm labs; 'roughly 20 °C' wording keeps me |
| 2ad932c2 | General Knowledge | Which city serves as the capital of Kazakhstan, the world's  | B | Astana (B) intended; note city renamed back to Astana in 2022 after being Nur-Sultan — fine, but 'world's largest landlo |
| 09c5ad08 | General Knowledge | Which letter of the alphabet appears in the name of no state | D | Re-verified against full options: Both Q and Z appear in no US state name; J appears in New Jersey. Q (and Z, X) all qua |
| 325c9bcc | General Knowledge | Which country is home to the ancient pyramids of Giza? | D | Egypt (D) intended and correct for the famous Giza pyramids — but option A 'Sudan' has more pyramids total (Meroë); as w |
| 435ccd38 | Science | Which element has the highest density of any naturally occur | A | Osmium (A) vs iridium — densest element is debated osmium/iridium by measurement method; osmium commonly cited, acceptab |
| 3299c3da | Technology | Which of the following is NOT a higher-order function in Pyt | D | len (D) intended as NOT higher-order — correct; but sorted with key= is arguably higher-order usage; conventional readin |
| fd47f5e4 | Space | Which spacecraft was the first to orbit an asteroid? | C | NEAR Shoemaker orbited Eros (C) — first spacecraft to orbit an asteroid; Galileo also flew by Gaspra/Ida but didn't orbi |
| d87d54d0 | Logic | What can you hold in your left hand but never in your right  | A | 'Your right hand' (A) intended, but 'your left hand' also holdable in left hand — both defensible; also duplicate of the |
| 638b1f5a | Logic | The inventor doesn't want it; the buyer doesn't use it; the  | A | Coffin (A) is the classic answer, but 'a medicine' also fits loosely; mild ambiguity. |
| d63cc359 | History | Who was the last active pharaoh of ancient Egypt before it b | A | Cleopatra VII (A) — commonly 'last pharaoh'; technically Caesarion reigned briefly after her. Conventional answer fine. |

## Recommended actions

1. **Delete (near-duplicate riddles with wording variants):** the two "left hand / right hand" Logic items — keep one, reword options so only one answer is physically impossible.
2. **Reword:** US-states-letter question → "Which of these letters appears in no U.S. state name?" (options J,Q,X,Z → only J appears, becomes single-answer).
3. **Reword:** Kazakhstan item is fine but references the 2019-2022 Nur-Sultan rename — acceptable; keep.
4. **Reword:** pyramids question → "In which modern country are the Giza pyramids?" to kill the Sudan-has-more-pyramids trap.
5. **Keep with note:** France timezones, osmium density, mercury gallium, NEAR Shoemaker, coffin/river riddles — classic quiz fare, minor edge cases.

Bottom line: **no factually wrong answers found in 200 sampled**; quality is high. ~6.5% ambiguous is typical for AI-generated banks; fix the 4 reword items above.
