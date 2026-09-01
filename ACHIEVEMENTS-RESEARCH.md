# QUIZORA Achievement System — Research & Design

*Grounded in: Stack Overflow badge taxonomy (bronze/silver/gold, rarity spread), Duolingo's retention mechanics (streaks, leagues, achievements — ~40 min/day engagement), QuizUp (speed+accuracy scoring, topic mastery, challenges), and gamification research (Wikipedia/gamification literature: points/badges as feedback mechanisms, badges as social status signals, leaderboards motivate the top but demotivate the bottom).*

---

## 1. Design Principles (distilled)

1. **Early wins first.** The first 3–5 achievements should unlock within the first 1–2 games. Duolingo/QuizUp hook users by making them feel competent immediately (self-efficacy → motivation).
2. **Visible locked badges drive aspiration.** Show locked achievements greyed out with their condition — players need a visible "next thing" (goal-gradient effect: effort accelerates near a goal).
3. **Tier by rarity, not difficulty.** Stack Overflow's bronze/silver/gold maps to how *many* players earn it, not how *hard* it feels. Spread: ~80% bronze, ~15% silver, ~5% gold. A few <1% prestige badges.
4. **Badges are social signals.** Research: badges "symbolize membership in a group" — display unlocked count + rarest badge on the profile header and share cards.
5. **Surprise achievements** ("you unlocked X!") mid/post-game create dopamine spikes without the player chasing them. Evaluate silently at game end; notify on the results screen.
6. **Avoid pure-volume grind badges dominating.** Duolingo's lesson: volume badges (X games played) are filler; performance and mastery badges create identity ("I'm a History guy").
7. **Leaderboards demotivate the bottom.** Achievements give non-top-players a personal progress axis that leaderboards don't. That's their retention role here.

## 2. Recommended Achievements (22)

**Onboarding / Early (unlock in first session)**
| Name | Trigger | Tier | Why |
|---|---|---|---|
| First Steps | Play your first game | Bronze | Immediate unlock, removes cold-start |
| Opening Win | Win your first 1v1 | Bronze | Early competence signal |
| Perfect Start | Win your first tournament match | Silver | Pulls players into tournaments early |
| Full Deck | Play a game in every category | Gold | Teaches the category breadth, long-horizon onboarding |

**Volume Milestones**
| Name | Trigger | Tier | Why |
|---|---|---|---|
| Regular | 10 games played | Bronze | Sticks players past week one |
| Veteran | 100 games played | Silver | Mid-term identity |
| Century Club | 500 games played | Gold | Rare dedication marker |
| Marathoner | Answer 5,000 questions total | Silver | Volume without win-dependence (fair to losing players) |

**Performance**
| Name | Trigger | Tier | Why |
|---|---|---|---|
| Flawless | Win a game 100% correct (all questions right) | Silver | Aspirational but reachable |
| Hot Streak | 10 correct answers in a row within one game | Silver | Per-question dopamine moment |
| Untouchable | Win a game conceding zero points to opponent | Gold | Dominant win, memorable |
| Sniper | Win a game with avg answer time < 3.0s | Gold | Rewards speed-skill style |
| Comeback Kid | Win after trailing by ≥ 60% of max score | Gold | Emotional peak moment, stories get shared |

**Category Mastery (per-category, evaluates on best category)**
| Name | Trigger | Tier | Why |
|---|---|---|---|
| Specialist | 25 wins in one category | Bronze | Identity creation ("History guy") |
| Scholar | 100 wins in one category | Silver | Deep specialization |
| Grandmaster | 250 wins in one category | Gold | Endgame goal for mains |
| Polymath | Win at least 5 games in all 10 categories | Gold | Anti-specialization balance, very rare |

**Social / Competitive**
| Name | Trigger | Tier | Why |
|---|---|---|---|
| Bracket Breaker | Win your first tournament | Silver | Tournament funnel incentive |
| Rival | Beat the same opponent 5 times | Bronze | Narrative/rivalry hook |
| Rematcher | Play 10 rematch games | Bronze | Directly incentivizes the rematch loop |
| Champion | Win 10 tournaments | Gold | Long-term tournament identity |

**Prestige (<1% — the legends)**
| Name | Trigger | Tier | Why |
|---|---|---|---|
| Mind Palace | Win a game with zero wrong answers across 3 consecutive games | Epic | Rare consistency flex |
| Lightning God | 50 correct answers under 2.0s in one day | Epic | Extreme speed achievement, session-defining |
| Immortal | Reach a 30-day play streak | Epic | Duolingo's proven strongest hook, badge-ified |

*(Epic = gold-tier rarity, <1%, distinct badge frame on profile.)*

## 3. Rarity Targets

- **Bronze:** 60–90% of active players eventually unlock (onboarding + early volume)
- **Silver:** 10–25%
- **Gold:** 2–8%
- **Epic:** <1%
- Review quarterly via a `achievement_unlock_counts` query; retune thresholds that land >95% or <0.2%.

## 4. Implementation Notes — stats the write path must capture

At game end, the server already knows per-question correctness + answer times. Persist into `game_results` / aggregate into `player_stats`:

- `games_played`, `wins`, `losses`, `tournament_wins`, `tournament_matches`
- `total_correct`, `total_answered`
- `best_in_game_correct_streak` (per game, max consecutive correct)
- `avg_answer_time_ms` (per game + lifetime)
- `score_self`, `score_opponent`, `max_score_possible` (for comeback detection: trailing at midpoint ≥ 60% and won)
- `opponent_id` (for rival tracking — small `matchup_counts` map or table)
- `category_correct_counts` / `category_wins` (JSON or rows keyed by category)
- `play_dates` (for streak: distinct dates + current/best streak)
- `rematch_flag` (whether game originated from a rematch button)
- `consecutive_perfect_wins` (rolling counter for Mind Palace)

Evaluation: single `evaluateAchievements(userId, gameContext)` function run transactionally at game end; inserts new rows into `achievements` table; returns newly-unlocked list so the results screen can show the "Achievement unlocked" banner (surprise mechanic).
