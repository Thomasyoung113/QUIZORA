// E2E: SSE live 2-player room on production.
// A creates room, B joins, both watch SSE, A starts, both answer r1,
// round closes (all answered), r2 begins, answered, finish via host.
const BASE = "https://quizora-phi.vercel.app";

const jarA = {};
const jarB = {};

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
function storeCookies(jar, res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const eq = kv.indexOf("=");
    jar[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
}
async function api(jar, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify(body ?? {}),
  });
  storeCookies(jar, res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// Minimal SSE reader with auto-reconnect on 'bye' (server stream lifetime is 25s).
async function readSSE(code, predicate, timeoutMs = 30_000) {
  const events = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await readSSEOnce(code, (ev) => {
      events.push(ev);
      return predicate(ev, events);
    }, deadline - Date.now());
    if (r.ok) return { ok: true, events };
    if (r.reason !== "bye") return { ok: false, events, reason: r.reason };
    // server closed stream with bye -> reconnect and keep watching
  }
  return { ok: false, events, reason: "timeout" };
}
function readSSEOnce(code, onEvent, timeoutMs) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); resolve({ ok: false, reason: "timeout" }); }, Math.max(timeoutMs, 2000));
    fetch(`${BASE}/api/stream?code=${code}`, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } })
      .then(async (res) => {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { clearTimeout(timer); resolve({ ok: false, reason: "stream-ended" }); return; }
            buf += dec.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf("\n\n")) >= 0) {
              const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
              const evLine = chunk.split("\n").find((l) => l.startsWith("event: "));
              const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (!evLine) continue;
              const ev = { event: evLine.slice(7).trim(), data: dataLine ? JSON.parse(dataLine.slice(6)) : null };
              if (ev.event === "bye") { clearTimeout(timer); ctrl.abort(); resolve({ ok: false, reason: "bye" }); return; }
              if (ev.event === "gone" || ev.event === "closed") { clearTimeout(timer); resolve({ ok: false, reason: ev.event }); return; }
              if (onEvent(ev)) { clearTimeout(timer); ctrl.abort(); resolve({ ok: true }); return; }
            }
          }
        } catch (e) {
          clearTimeout(timer);
          resolve(ctrl.signal.aborted ? { ok: true } : { ok: false, reason: String(e) });
        }
      })
      .catch((e) => { clearTimeout(timer); resolve({ ok: false, reason: String(e) }); });
  });
}

const results = [];
const t = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

// --- 1. create + join ---
const a = await api(jarA, "/api/rooms/create", { displayName: "E2E-Host" });
t("create room", a.status === 200 && !!a.json.roomCode, `code=${a.json.roomCode}`);
const code = a.json.roomCode;

const b = await api(jarB, "/api/rooms/join", { code, displayName: "E2E-Guest" });
t("join room", b.status === 200, JSON.stringify(b.json).slice(0, 120));

// --- 2. SSE: both players should see player-list update (B joined) ---
const sseB = await readSSE(code, (ev) => ev.event === "state" && JSON.stringify(ev.data).includes("E2E-Guest"), 20_000);
t("SSE delivers state with joined player", sseB.ok, `${sseB.events.length} events`);

// --- 3. host starts game ---
const start = await api(jarA, "/api/game", {
  action: "start",
  roomId: a.json.roomId ?? undefined,
  settings: { game_mode: "classic", difficulty: "easy", categories: ["Science"], timer_seconds: 15, total_rounds: 2, speed_bonus: false, streak_bonus: false, explanations: true },
});
// create response may not include roomId; fetch via room-state
let roomId = a.json.roomId;
if (!roomId) {
  const st = await fetch(`${BASE}/api/room-state?code=${code}`, { headers: { cookie: cookieHeader(jarA) } });
  const stj = await st.json().catch(() => ({}));
  roomId = stj.room?.id ?? stj.id;
}
const start2 = roomId && start.status !== 200
  ? await api(jarA, "/api/game", { action: "start", roomId, settings: { game_mode: "classic", difficulty: "easy", categories: ["Science"], timer_seconds: 15, total_rounds: 2, speed_bonus: false, streak_bonus: false, explanations: true } })
  : start;
t("start game", start2.status === 200 && !!start2.json.gameId, JSON.stringify(start2.json).slice(0, 150));
const gameId = start2.json.gameId;

// --- 4. both players fetch round 1 (anti-cheat: no correct_option pre-close) ---
const r1 = async (jar) => {
  const res = await fetch(`${BASE}/api/round?gameId=${gameId}&round=1`, { headers: { cookie: cookieHeader(jar) } });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const ra = await r1(jarA), rb = await r1(jarB);
t("round 1 readable by both", ra.status === 200 && rb.status === 200, `A:${ra.status} B:${rb.status}`);
const noLeak = !("correct_option" in (ra.json ?? {})) && !ra.json?.correct_option;
t("no answer leak pre-close", noLeak, JSON.stringify(Object.keys(ra.json ?? {})).slice(0, 100));

// --- 5. both answer round 1 ---
const ans1 = await api(jarA, "/api/game", { action: "answer", gameId, roundNumber: 1, option: "A" });
const ans2 = await api(jarB, "/api/game", { action: "answer", gameId, roundNumber: 1, option: "B" });
t("A answers r1", ans1.status === 200, JSON.stringify(ans1.json).slice(0, 120));
t("B answers r1", ans2.status === 200, JSON.stringify(ans2.json).slice(0, 120));

// --- 6. duplicate answer rejected ---
const dup = await api(jarA, "/api/game", { action: "answer", gameId, roundNumber: 1, option: "C" });
t("duplicate answer rejected", dup.status >= 400, `status=${dup.status}`);

// --- 7. SSE round events: open -> closed (closedAt non-null) ---
// The closed round event is only emitted once the HOST closes the round, so
// fire closeRound while the SSE reader is watching — otherwise the test only
// passes if it gets lucky with a stream reconnect after step 7b.
const revealPromise = readSSE(code, (ev, evts) => ev.event === "round" && ev.data?.closedAt, 30_000);
await new Promise((r) => setTimeout(r, 1500)); // let the initial snapshot + open event arrive
const cr1 = await api(jarA, "/api/game", { action: "closeRound", gameId, roomId, roundNumber: 1 });
t("closeRound 1 (all answered)", cr1.status === 200, JSON.stringify(cr1.json).slice(0, 120));
const reveal = await revealPromise;
const sawOpen = reveal.events.some((e) => e.event === "round" && !e.data?.closedAt);
t("SSE sees round open->closed transition", reveal.ok && sawOpen, reveal.events.map((e) => `${e.event}:${JSON.stringify(e.data)?.slice(0, 70)}`).join(" | ") || "none");

// --- 8. next round / finish ---
const bg = await api(jarA, "/api/game", { action: "beginRound", gameId, roundNumber: 2 });
t("beginRound 2", bg.status === 200, JSON.stringify(bg.json).slice(0, 120));
const ans3 = await api(jarA, "/api/game", { action: "answer", gameId, roundNumber: 2, option: "A" });
const ans4 = await api(jarB, "/api/game", { action: "answer", gameId, roundNumber: 2, option: "B" });
t("both answer r2", ans3.status === 200 && ans4.status === 200, `A:${ans3.status} B:${ans4.status}`);
const cr2 = await api(jarA, "/api/game", { action: "closeRound", gameId, roomId, roundNumber: 2 });
t("closeRound 2 auto-finishes (last round)", cr2.status === 200, JSON.stringify(cr2.json).slice(0, 120));

// --- 9. negative checks ---
const neg = await api({}, "/api/rooms/join", { code: "ZZZZZZ", displayName: "E2E-Neg" });
t("join non-existent room fails cleanly", neg.status === 404, `status=${neg.status} ${JSON.stringify(neg.json).slice(0, 80)}`);
const negStart = await api(jarB, "/api/game", { action: "start", roomId, settings: { game_mode: "classic", difficulty: "easy", categories: ["Science"], timer_seconds: 15, total_rounds: 1, speed_bonus: false, streak_bonus: false, explanations: true } });
t("non-host cannot start game", negStart.status >= 400, `status=${negStart.status}`);
const negClose = await api(jarB, "/api/game", { action: "closeRound", gameId, roomId, roundNumber: 99 });
t("closeRound bogus round rejected", negClose.status >= 400, `status=${negClose.status}`);

console.log("\nSUMMARY:", results.filter(r => r.ok).length, "/", results.length, "passed");
console.log(JSON.stringify(results, null, 1));
