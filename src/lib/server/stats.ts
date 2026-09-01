import type { serviceClient } from "./game";

type DB = ReturnType<typeof serviceClient>;

interface PlayerRow {
  id: string;
  user_id: string | null;
  display_name: string;
  is_host: boolean;
}

interface AnswerRow {
  game_question_id: string;
  player_id: string;
  response_ms: number | null;
  is_correct: boolean | null;
  points: number;
  forfeited: boolean;
}

interface GameQuestionRow {
  id: string;
  round_number: number;
  question_id: string;
  category: string;
}

// ELO K-factor
const K = 32;
const TOURNAMENT_WIN = 24;
const TOURNAMENT_LOSS = -12;

interface EvalContext {
  userId: string;
  gameId: string;
  isWin: boolean;
  isDraw: boolean;
  mode: "1v1" | "tournament";
  score: number;
  opponentScore: number;
  correct: number;
  totalQuestions: number;
  avgAnswerMs: number | null;
  bestStreak: number;
  comeback: boolean;
  opponentUserId: string | null;
  categories: string[];
}

/**
 * Called once per finished game. Writes stats, ELO, history, and evaluates
 * achievements. All errors are swallowed + logged so game end NEVER breaks.
 */
export async function recordGameEnd(db: DB, gameId: string, roomId: string): Promise<void> {
  try {
    await recordGameEndInner(db, gameId, roomId);
  } catch (e) {
    console.error("[stats] recordGameEnd failed", { gameId, roomId, error: e });
  }
}

async function recordGameEndInner(db: DB, gameId: string, roomId: string): Promise<void> {
  // Idempotency: skip if results already written for this game
  const { data: existing } = await db
    .from("game_results")
    .select("id")
    .eq("game_id", gameId)
    .limit(1);
  if (existing && existing.length > 0) return;

  const { data: game } = await db
    .from("games")
    .select("id, game_mode, categories, status")
    .eq("id", gameId)
    .single();
  if (!game || game.status !== "finished") return;

  const { data: players } = await db
    .from("room_players")
    .select("id, user_id, display_name, is_host")
    .eq("room_id", roomId);
  const playerRows = (players ?? []) as PlayerRow[];
  if (playerRows.length < 2) return;

  const { data: gqs } = await db
    .from("game_questions")
    .select("id, round_number, question_id, questions(category)")
    .eq("game_id", gameId)
    .order("round_number", { ascending: true });
  const gqRows = (gqs ?? []) as unknown as GameQuestionRow[];
  if (!gqRows.length) return;

  const { data: answers } = await db
    .from("answers")
    .select("game_question_id, player_id, response_ms, is_correct, points, forfeited")
    .in("game_question_id", gqRows.map((g) => g.id));
  const answerRows = (answers ?? []) as AnswerRow[];

  const totalQuestions = gqRows.length;
  const mode: "1v1" | "tournament" = playerRows.length > 2 || game.game_mode === "tournament" ? "tournament" : "1v1";

  // Per-player aggregates
  const stats = new Map<string, {
    playerId: string; userId: string | null; name: string; score: number; correct: number;
    answered: number; fast: number; bestStreak: number; streak: number; categories: Set<string>;
    trail: number[]; // running score for comeback detection
  }>();
  for (const p of playerRows) {
    stats.set(p.id, {
      playerId: p.id, userId: p.user_id, name: p.display_name, score: 0, correct: 0,
      answered: 0, fast: 0, bestStreak: 0, streak: 0, categories: new Set(), trail: [0],
    });
  }

  // Walk answers in round order for streaks + comeback trail
  const gqOrder = new Map(gqRows.map((g, i) => [g.id, i]));
  const ordered = [...answerRows].sort(
    (a, b) => (gqOrder.get(a.game_question_id) ?? 0) - (gqOrder.get(b.game_question_id) ?? 0)
  );
  for (const a of ordered) {
    const s = stats.get(a.player_id);
    if (!s) continue;
    const correct = a.is_correct === true;
    s.score += a.points ?? 0;
    s.answered += 1;
    if (correct) {
      s.correct += 1;
      if ((a.response_ms ?? Infinity) < 3000) s.fast += 1;
      s.streak += 1;
      s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.streak = 0;
    }
  }
  // comeback trail: snapshot running scores per round for each player
  const running = new Map<string, number>();
  for (const p of playerRows) running.set(p.id, 0);
  for (const g of gqRows) {
    for (const a of answerRows.filter((x) => x.game_question_id === g.id)) {
      const s = stats.get(a.player_id);
      if (s) running.set(a.player_id, (running.get(a.player_id) ?? 0) + (a.points ?? 0));
    }
    for (const s of stats.values()) s.trail.push(running.get(s.playerId) ?? 0);
  }

  // Ranking by score
  const ranked = [...stats.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  const isDraw = ranked.length > 1 && ranked[0].score === ranked[1].score;

  // Determine opponent name per player (2-player: the other; tournament: best-of-others label)
  const opponentFor = (pid: string): string | null => {
    if (ranked.length === 2) return ranked.find((r) => r.playerId !== pid)?.name ?? null;
    return `${ranked.length - 1} opponents`;
  };

  const userIds = playerRows.filter((p) => p.user_id).map((p) => p.user_id as string);
  const profileRatings = new Map<string, number>();
  if (userIds.length) {
    const { data: profs } = await db.from("profiles").select("id, rating").in("id", userIds);
    for (const pr of (profs ?? []) as { id: string; rating: number }[]) profileRatings.set(pr.id, pr.rating);
  }

  // ELO: for 1v1 with 2 rated players, zero-sum. Tournament: base delta.
  const eloUpdate = new Map<string, number>();
  if (mode === "1v1" && ranked.length === 2) {
    const [a, b] = ranked;
    const ra = profileRatings.get(a.userId ?? "") ?? null;
    const rb = profileRatings.get(b.userId ?? "") ?? null;
    if (ra !== null && rb !== null && a.userId && b.userId) {
      const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const eb = 1 - ea;
      const sa = isDraw ? 0.5 : a.score > b.score ? 1 : 0;
      eloUpdate.set(a.userId, Math.round(K * (sa - ea)));
      eloUpdate.set(b.userId, Math.round(K * ((1 - sa) - eb)));
    }
  } else if (mode === "tournament") {
    for (const s of ranked) {
      if (!s.userId) continue;
      eloUpdate.set(s.userId, isDraw ? 0 : s.score === top.score ? TOURNAMENT_WIN : TOURNAMENT_LOSS);
    }
  }

  const now = new Date().toISOString();

  for (const s of stats.values()) {
    if (!s.userId) continue; // guests: no stats
    const isWin = !isDraw && s.score === top.score && top.score > 0 ? s.playerId === top.playerId : false;
    const opponentScore = opponentFor(s.playerId) ? (s.playerId === top.playerId ? (second?.score ?? 0) : top.score) : 0;

    // Comeback: at some trail point was >=60% behind final winner's score, then won.
    const winnerFinal = top.score;
    const wasBehind = s.trail.some((v) => winnerFinal > 0 && v <= winnerFinal * 0.4);
    const comeback = isWin && wasBehind;

    // avg answer ms across answered questions
    const myAnswers = answerRows.filter((a) => a.player_id === s.playerId);
    const withMs = myAnswers.filter((a) => a.response_ms !== null && !a.forfeited);
    const avgMs = withMs.length
      ? Math.round(withMs.reduce((acc, a) => acc + (a.response_ms ?? 0), 0) / withMs.length)
      : null;

    // Insert game_results (unique index guards double-insert)
    await db.from("game_results").upsert(
      {
        game_id: gameId,
        user_id: s.userId,
        display_name: s.name,
        opponent_name: opponentFor(s.playerId),
        is_win: isWin,
        is_draw: isDraw,
        score: s.score,
        opponent_score: opponentScore,
        correct: s.correct,
        total_questions: totalQuestions,
        avg_answer_ms: avgMs,
        best_streak: s.bestStreak,
        correct_streak_max: s.bestStreak,
        fast_answers: s.fast,
        comeback,
        mode,
        created_at: now,
      },
      { onConflict: "game_id,user_id" }
    );

    // Profile aggregates upsert
    const prevRating = profileRatings.get(s.userId) ?? 1000;
    const newRating = prevRating + (eloUpdate.get(s.userId) ?? 0);
    const { data: prevProf } = await db
      .from("profiles")
      .select("total_games, total_wins, total_questions, correct_answers, best_streak, xp, avg_answer_ms, current_streak")
      .eq("id", s.userId)
      .single();
    const p = (prevProf ?? {}) as {
      total_games?: number; total_wins?: number; total_questions?: number; correct_answers?: number;
      best_streak?: number; xp?: number; avg_answer_ms?: number | null; current_streak?: number;
    };
    const newGames = (p.total_games ?? 0) + 1;
    const newWins = (p.total_wins ?? 0) + (isWin ? 1 : 0);
    const newQuestions = (p.total_questions ?? 0) + totalQuestions;
    const newCorrect = (p.correct_answers ?? 0) + s.correct;
    const newBestStreak = Math.max(p.best_streak ?? 0, s.bestStreak);
    const newXp = (p.xp ?? 0) + s.score;
    // running mean of avg answer times
    const newAvgMs = avgMs !== null
      ? p.avg_answer_ms !== null && p.avg_answer_ms !== undefined
        ? Math.round((p.avg_answer_ms * (newGames - 1) + avgMs) / newGames)
        : avgMs
      : p.avg_answer_ms ?? null;
    const newStreak = isWin ? (p.current_streak ?? 0) + 1 : 0;

    await db
      .from("profiles")
      .update({
        total_games: newGames,
        total_wins: newWins,
        total_questions: newQuestions,
        correct_answers: newCorrect,
        best_streak: newBestStreak,
        xp: newXp,
        avg_answer_ms: newAvgMs,
        rating: newRating,
        current_streak: newStreak,
        last_played_at: now,
        updated_at: now,
      })
      .eq("id", s.userId);

    // Per-category upsert
    const catSet = new Set<string>();
    for (const g of gqRows) {
      const cat = (g as unknown as { questions?: { category: string } }).questions?.category;
      if (cat) catSet.add(cat);
    }
    for (const cat of catSet) {
      const myCatAnswers = answerRows.filter((a) => {
        const g = gqRows.find((x) => x.id === a.game_question_id);
        const c = (g as unknown as { questions?: { category: string } } | undefined)?.questions?.category;
        return a.player_id === s.playerId && c === cat;
      });
      const catCorrect = myCatAnswers.filter((a) => a.is_correct === true).length;
      const catBest = Math.max(s.bestStreak, 0);
      await db
        .from("player_category_stats")
        .upsert(
          {
            user_id: s.userId,
            category: cat,
            games: 1,
            wins: isWin ? 1 : 0,
            correct: catCorrect,
            total: myCatAnswers.length,
            best_streak: catBest,
          },
          { onConflict: "user_id,category" }
        );
      // games/wins need increment, not overwrite — do a read-modify-write
      const { data: prevCat } = await db
        .from("player_category_stats")
        .select("games, wins, correct, total, best_streak")
        .eq("user_id", s.userId)
        .eq("category", cat)
        .single();
      if (prevCat) {
        await db
          .from("player_category_stats")
          .update({
            games: (prevCat as { games: number }).games + 1,
            wins: (prevCat as { wins: number }).wins + (isWin ? 1 : 0),
            correct: (prevCat as { correct: number }).correct + catCorrect,
            total: (prevCat as { total: number }).total + myCatAnswers.length,
            best_streak: Math.max((prevCat as { best_streak: number }).best_streak, catBest),
          })
          .eq("user_id", s.userId)
          .eq("category", cat);
      }
    }

    // Achievement evaluation
    await evaluateAchievements(db, s.userId, {
      userId: s.userId,
      gameId,
      isWin,
      isDraw,
      mode,
      score: s.score,
      opponentScore,
      correct: s.correct,
      totalQuestions,
      avgAnswerMs: avgMs,
      bestStreak: s.bestStreak,
      comeback,
      opponentUserId: ranked.length === 2 ? (ranked.find((r) => r.playerId !== s.playerId)?.userId ?? null) : null,
      categories: [...catSet],
    });
  }
}

async function unlock(db: DB, userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db
    .from("profile_achievements")
    .upsert(
      ids.map((achievement_id) => ({ user_id: userId, achievement_id, progress: 100 })),
      { onConflict: "user_id,achievement_id", ignoreDuplicates: true }
    );
}

async function evaluateAchievements(db: DB, userId: string, ctx: EvalContext): Promise<void> {
  const { data: prof } = await db
    .from("profiles")
    .select("total_games, total_wins, total_questions, correct_answers, best_streak, current_streak")
    .eq("id", userId)
    .single();
  const p = (prof ?? {}) as {
    total_games?: number; total_wins?: number; total_questions?: number;
    correct_answers?: number; best_streak?: number; current_streak?: number;
  };
  const unlocked: string[] = [];

  // Onboarding
  if ((p.total_games ?? 0) >= 1) unlocked.push("first_steps");
  if (ctx.mode === "1v1" && ctx.isWin) unlocked.push("opening_win");
  if (ctx.mode === "tournament" && ctx.isWin) unlocked.push("perfect_start");

  // Volume
  if ((p.total_games ?? 0) >= 10) unlocked.push("regular");
  if ((p.total_games ?? 0) >= 100) unlocked.push("veteran");
  if ((p.total_games ?? 0) >= 500) unlocked.push("century_club");
  if ((p.total_questions ?? 0) >= 5000) unlocked.push("marathoner");

  // Performance (per-game, must be a WIN)
  if (ctx.isWin && ctx.correct === ctx.totalQuestions && ctx.totalQuestions > 0) unlocked.push("flawless");
  if (ctx.isWin && ctx.bestStreak >= 10) unlocked.push("hot_streak");
  if (ctx.isWin && ctx.opponentScore === 0 && ctx.score > 0) unlocked.push("untouchable");
  if (ctx.isWin && ctx.avgAnswerMs !== null && ctx.avgAnswerMs < 3000) unlocked.push("sniper");
  if (ctx.isWin && ctx.comeback) unlocked.push("comeback_kid");

  // Category mastery — read from player_category_stats
  const { data: cats } = await db
    .from("player_category_stats")
    .select("category, wins, games")
    .eq("user_id", userId);
  const catRows = (cats ?? []) as { category: string; wins: number; games: number }[];
  const maxWins = Math.max(0, ...catRows.map((c) => c.wins));
  if (maxWins >= 25) unlocked.push("specialist");
  if (maxWins >= 100) unlocked.push("scholar");
  if (maxWins >= 250) unlocked.push("grandmaster");
  if (catRows.length >= 10 && catRows.every((c) => c.wins >= 5)) unlocked.push("polymath");
  if (catRows.length >= 10) unlocked.push("full_deck");

  // Social
  // rival: need history vs same opponent
  if (ctx.opponentUserId && ctx.isWin) {
    const { data: rivalWins } = await db
      .from("game_results")
      .select("id, user_id, opponent_name")
      .eq("user_id", userId)
      .eq("is_win", true)
      .limit(500);
    // Count wins vs same opponent by name (denormalized). Approximate.
    const oppName = ctx.opponentUserId
      ? ((await db.from("profiles").select("username").eq("id", ctx.opponentUserId).single()) as unknown as { username?: string } | null)?.username
      : null;
    const count = (rivalWins ?? []).filter((r: { opponent_name: string | null }) => r.opponent_name === oppName).length;
    if (oppName && count >= 5) unlocked.push("rival");
  }
  // rematcher: approximate via repeated game_ids in same room — skipped for now
  // (needs room linkage in game_results; see Issues in report)

  // Tournament wins
  if (ctx.mode === "tournament" && ctx.isWin) {
    // bracket win ≠ tournament win; only final winners count — approximate via mode+tournament handling elsewhere
  }

  // Prestige
  if (ctx.isWin && ctx.correct === ctx.totalQuestions && ctx.totalQuestions > 0) {
    // mind_palace: 3 consecutive flawless wins — check last 2 game_results
    const { data: recent } = await db
      .from("game_results")
      .select("correct, total_questions, is_win, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(3);
    const rows = (recent ?? []) as { correct: number; total_questions: number; is_win: boolean }[];
    if (rows.length >= 3 && rows.every((r) => r.is_win && r.correct === r.total_questions)) {
      unlocked.push("mind_palace");
    }
  }
  // lightning_god: fast answers today
  {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: today } = await db
      .from("game_results")
      .select("fast_answers")
      .eq("user_id", userId)
      .gte("created_at", dayAgo);
    const totalFast = ((today ?? []) as { fast_answers: number }[]).reduce((a, r) => a + r.fast_answers, 0);
    if (totalFast >= 50) unlocked.push("lightning_god");
  }
  if ((p.current_streak ?? 0) >= 30) unlocked.push("immortal");

  await unlock(db, userId, unlocked);
}
