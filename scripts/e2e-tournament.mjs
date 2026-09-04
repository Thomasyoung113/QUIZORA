// E2E: 4-player tournament on production (authenticated via admin magic-link OTP).
import { readFileSync } from "fs";

const BASE = "https://quizora-phi.vercel.app";
const SB = "https://jemvqhvpnlyrlazvkiro.supabase.co";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const SRK = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function pidFor(uid, roomCode) {
  // resolve room id, then the room_players row id for this user
  const r = await fetch(`${SB}/rest/v1/rooms?room_code=eq.${roomCode}&select=id`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  const room = (await r.json())[0];
  const q = await fetch(`${SB}/rest/v1/room_players?room_id=eq.${room.id}&user_id=eq.${uid}&select=id`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  const row = (await q.json())[0];
  return row?.id ?? null;
}

const results = [];
const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(email) {
  const gen = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const gj = await gen.json();
  if (!gj.email_otp) throw new Error(`generate_link failed: ${JSON.stringify(gj).slice(0, 150)}`);
  const verify = await fetch(`${SB}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email, token: gj.email_otp }),
  });
  const vj = await verify.json();
  if (!vj.access_token) throw new Error(`verify failed: ${JSON.stringify(vj).slice(0, 150)}`);
  return { token: vj.access_token, uid: vj.user?.id };
}

async function tapi(token, body) {
  const res = await fetch(`${BASE}/api/tournament`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, cookie: `quizora_at=${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

// Room/game actions with a token (authenticated room player)
async function rapi(token, body, pid) {
  const res = await fetch(`${BASE}/api/game`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, cookie: `quizora_at=${token}; quizora_pid=${pid}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function roundFetch(token, gameId, round, pid) {
  const res = await fetch(`${BASE}/api/round?gameId=${gameId}&round=${round}`, {
    headers: { Authorization: `Bearer ${token}`, cookie: `quizora_at=${token}; quizora_pid=${pid}` },
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const users = ["e2e-t1@quizoratest.dev", "e2e-t2@quizoratest.dev", "e2e-t3@quizoratest.dev", "e2e-t4@quizoratest.dev"];
const tokens = [];
for (const u of users) {
  try { tokens.push(await login(u)); } catch (e) { console.log(`login fail ${u}: ${e.message}`); tokens.push(null); }
}
const loggedIn = tokens.filter(Boolean).length;
const tokenOf = (uid) => tokens.find(x => x?.uid === uid)?.token;
t("4 users logged in", loggedIn === 4, `${loggedIn}/4 via admin OTP`);

if (loggedIn < 4) { console.log("BLOCKED: cannot complete tournament without 4 logins"); }
else {
  const host = tokens[0].token;
  const cr = await tapi(host, { action: "create", size: 4, difficulty: "easy", categories: ["Science"], timer_seconds: 15, rounds_per_match: 1 });
  t("tournament created", cr.status === 200 && !!cr.json.code, `code=${cr.json.code}`);

  for (const tk of tokens.slice(1)) {
    const j = await tapi(tk.token, { action: "join", code: cr.json.code });
    if (j.status !== 200) console.log(`  join err: ${JSON.stringify(j.json)}`);
  }
  const st0 = await tapi(host, { action: "state", tournamentId: cr.json.tournamentId });
  t("4 entries joined", (st0.json.entries?.length ?? 0) === 4, `${st0.json.entries?.length} entries`);

  const s = await tapi(host, { action: "start", tournamentId: cr.json.tournamentId });
  t("bracket seeded", s.status === 200, JSON.stringify(s.json).slice(0, 120));

  const st1 = await tapi(host, { action: "state", tournamentId: cr.json.tournamentId });
  const r1 = (st1.json.matches ?? []).filter(m => m.bracket_round === 1);
  t("R1 has 2 active matches with rooms", r1.length === 2 && r1.every(m => m.room && m.status === "active"), JSON.stringify(r1.map(m => [m.status, m.room?.room_code])).slice(0, 120));

  // Play both R1 matches to completion. Player A of each match = host-capable row (is_host true).
  for (const m of r1) {
    const rc = m.room.room_code;
    // figure out which tokens are in this match
    const paEntry = st1.json.entries.find(e => e.id === m.player_a_id);
    const pbEntry = st1.json.entries.find(e => e.id === m.player_b_id);
    const A = tokenOf(paEntry?.user_id), B = tokenOf(pbEntry?.user_id);
    if (!A || !B) { console.log(`  skip match ${rc}: token mapping failed`); continue; }

    // A is room host (is_host true). Start game.
    const roomId = m.room_id;
    const pidA = await pidFor(paEntry?.user_id, rc);
    const pidB = await pidFor(pbEntry?.user_id, rc);
    const st = await rapi(A, { action: "start", roomId, settings: { game_mode: "classic", difficulty: "easy", categories: ["Science"], timer_seconds: 15, total_rounds: 1, speed_bonus: false, streak_bonus: false, explanations: true } }, pidA);
    if (st.status !== 200) { console.log(`  start fail ${rc}: ${JSON.stringify(st.json)}`); continue; }
    const gameId = st.json.gameId;

    const q = await roundFetch(A, gameId, 1, pidA);
    const opts = q.json?.options ?? [];
    // Answer: A picks index 0, B picks index 1 (one may be wrong -> produces a decisive winner usually; ties fall to A)
    const a1 = await rapi(A, { action: "answer", gameId, roundNumber: 1, option: opts[0] ?? "A" }, pidA);
    const b1 = await rapi(B, { action: "answer", gameId, roundNumber: 1, option: opts[1] ?? "B" }, pidB);
    console.log(`  [${rc}] answers: A=${a1.status} B=${b1.status}`);
    const cr1 = await rapi(A, { action: "closeRound", gameId, roomId, roundNumber: 1 }, pidA);
    const fin = await rapi(A, { action: "finish", gameId, roomId }, pidA);
    console.log(`  [${rc}] close=${cr1.status} finish=${fin.status}`);
  }

  // Advance bracket (idempotent; any participant may call)
  let state = await tapi(host, { action: "state", tournamentId: cr.json.tournamentId });
  for (const m of (state.json.matches ?? []).filter(x => x.bracket_round === 1 && !x.winner_entry_id)) {
    const adv = await tapi(host, { action: "advance", tournamentId: cr.json.tournamentId, matchId: m.id });
    console.log(`  advance R1/${m.match_slot}: ${adv.status} ${JSON.stringify(adv.json).slice(0, 100)}`);
  }
  state = await tapi(host, { action: "state", tournamentId: cr.json.tournamentId });
  const r1w = (state.json.matches ?? []).filter(x => x.bracket_round === 1).every(x => x.winner_entry_id);
  t("R1 winners decided", r1w, JSON.stringify((state.json.matches ?? []).filter(x => x.bracket_round === 1).map(x => x.winner_entry_id ? "w" : "x")));

  const r2 = (state.json.matches ?? []).filter(x => x.bracket_round === 2);
  if (r2.length) {
    const m = r2[0];
    const pa = state.json.entries.find(e => e.id === m.player_a_id);
    const pb = state.json.entries.find(e => e.id === m.player_b_id);
    const A = tokenOf(pa?.user_id), B = tokenOf(pb?.user_id);
    if (A && B && m.room) {
      const rc2 = m.room.room_code;
      const pidA = await pidFor(pa?.user_id, rc2);
      const pidB = await pidFor(pb?.user_id, rc2);
      const st = await rapi(A, { action: "start", roomId: m.room_id, settings: { game_mode: "classic", difficulty: "easy", categories: ["Science"], timer_seconds: 15, total_rounds: 1, speed_bonus: false, streak_bonus: false, explanations: true } }, pidA);
      if (st.status === 200) {
        const gameId = st.json.gameId;
        const q = await roundFetch(A, gameId, 1, pidA);
        const opts = q.json?.options ?? [];
        await rapi(A, { action: "answer", gameId, roundNumber: 1, option: opts[0] ?? "A" }, pidA);
        await rapi(B, { action: "answer", gameId, roundNumber: 1, option: opts[1] ?? "B" }, pidB);
        await rapi(A, { action: "closeRound", gameId, roomId: m.room_id, roundNumber: 1 }, pidA);
        await rapi(A, { action: "finish", gameId, roomId: m.room_id }, pidA);
      } else console.log(`  final start fail: ${JSON.stringify(st.json)}`);
    }
    for (let i = 0; i < 3; i++) {
      await tapi(host, { action: "advance", tournamentId: cr.json.tournamentId, matchId: m.id });
      await sleep(800);
    }
    const fin2 = await tapi(host, { action: "state", tournamentId: cr.json.tournamentId });
    const champion = fin2.json.tournament?.champion_user_id;
    t("tournament finished with champion", !!champion, `champion=${champion ?? "none"}, status=${fin2.json.tournament?.status}`);
  } else {
    t("R2 created", false, "no bracket_round=2 matches after R1 advanced");
  }
}

console.log("\nSUMMARY:", results.filter(r => r.ok).length, "/", results.length, "passed");
