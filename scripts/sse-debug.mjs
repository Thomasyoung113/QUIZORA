// Debug: watch raw SSE round events with timestamps during a full 1-round game
const BASE = "https://quizora-phi.vercel.app";
const jar = {};
function cookieHeader(j){return Object.entries(j).map(([k,v])=>`${k}=${v}`).join("; ")}
function storeCookies(j,res){for(const c of res.headers.getSetCookie?.() ?? []){const [kv]=c.split(";");const eq=kv.indexOf("=");j[kv.slice(0,eq)]=kv.slice(eq+1)}}
async function api(j,path,body){const res=await fetch(`${BASE}${path}`,{method:"POST",headers:{"Content-Type":"application/json",cookie:cookieHeader(j)},body:JSON.stringify(body??{})});storeCookies(j,res);return{status:res.status,json:await res.json().catch(()=>({}))}}

const t0 = Date.now();
const a = await api(jar, "/api/rooms/create", { displayName: "E2E-Dbg" });
const code = a.json.roomCode;
const jarB = {};
const b = await api(jarB, "/api/rooms/join", { code, displayName: "E2E-Dbg2" });

const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 50_000);
(async () => {
  const res = await fetch(`${BASE}/api/stream?code=${code}`, { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const evLine = chunk.split("\n").find(l => l.startsWith("event: "));
        const dataLine = chunk.split("\n").find(l => l.startsWith("data: "));
        if (!evLine) continue;
        const ev = { t: ((Date.now() - t0) / 1000).toFixed(1), event: evLine.slice(7).trim(), data: dataLine ? JSON.parse(dataLine.slice(6)) : null };
        console.log(`[${ev.t}s] ${ev.event}`, JSON.stringify(ev.data).slice(0, 160));
      }
    }
  } catch {}
})();

await new Promise(r => setTimeout(r, 1500));

let roomId = a.json.roomId;
if (!roomId) {
  const st = await fetch(`${BASE}/api/room-state?code=${code}`, { headers: { cookie: cookieHeader(jar) } });
  const stj = await st.json().catch(() => ({}));
  roomId = stj.room?.id ?? stj.id;
}
const s = await api(jar, "/api/game", { action: "start", roomId, settings: { game_mode: "classic", difficulty: "easy", categories: ["Science"], timer_seconds: 10, total_rounds: 1, speed_bonus: false, streak_bonus: false, explanations: true } });
console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] >> start`, s.status, s.json.gameId);
await new Promise(r => setTimeout(r, 2000));
const ans = await api(jar, "/api/game", { action: "answer", gameId: s.json.gameId, roundNumber: 1, option: "A" });
console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] >> answer`, ans.status);
await new Promise(r => setTimeout(r, 12_000)); // wait past 10s deadline
const cr = await api(jar, "/api/game", { action: "closeRound", gameId: s.json.gameId, roomId, roundNumber: 1 });
console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] >> closeRound`, cr.status, JSON.stringify(cr.json));
await new Promise(r => setTimeout(r, 5000));
ctrl.abort();
console.log("DONE");
