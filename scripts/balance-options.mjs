// Length-tell repair for QUIZORA's question bank.
// Flags questions where the CORRECT option is the longest (or shortest) by a
// clear margin, then rewrites ONLY the wrong distractors to similar lengths.
// The correct answer text and its letter are never modified, so no fact-check
// pass is needed.
//
// Usage: PARALLEL=6 node scripts/balance-options.mjs [maxQuestions]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const PROVIDERS = [
  { name: "b.ai", base: env.LLM_BASE_URL || "https://api.b.ai/v1", key: env.LLM_API_KEY, model: env.LLM_MODEL || "glm-5.3-flash", api: "openai" },
  { name: "bynara", base: env.BYNARA_BASE_URL || "https://router.bynara.id/v1", key: env.BYNARA_API_KEY, model: env.BYNARA_MODEL || "agnes-2.5-flash", api: "openai" },
  { name: "agentrouter-glm", base: env.AGENTROUTER_BASE_URL || "https://agentrouter.org", key: env.AGENTROUTER_API_KEY, model: "glm-5.3", api: "anthropic" },
  { name: "agentrouter-ds", base: env.AGENTROUTER_BASE_URL || "https://agentrouter.org", key: env.AGENTROUTER_API_KEY, model: "deepseek-v4-flash", api: "anthropic" },
  { name: "nvidia-ds", base: "https://integrate.api.nvidia.com/v1", key: env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY, model: "deepseek-ai/deepseek-v4-flash-0731", api: "openai" },
  { name: "nvidia-llama", base: "https://integrate.api.nvidia.com/v1", key: env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY, model: "mistralai/mistral-large-2-instruct", api: "openai" },
].filter((p) => p.key);
if (!PROVIDERS.length) { console.error("No providers configured"); process.exit(1); }

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PARALLEL = parseInt(process.env.PARALLEL || "6", 10);
const MAX = parseInt(process.argv[2] || "0", 10); // 0 = no cap
const GAP = 3; // correct must beat the next-longest by >=3 chars to count as a tell
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

let PROVIDER_IDX = 0;
async function llm(messages, maxTokens = 8000) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const p = PROVIDERS[PROVIDER_IDX % PROVIDERS.length];
    PROVIDER_IDX++;
    try {
      let res;
      if (p.api === "anthropic") {
        const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        const msgs = messages.filter((m) => m.role !== "system");
        res = await fetch(`${p.base}/v1/messages`, {
          method: "POST",
          headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({ model: p.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: msgs }),
        });
      } else {
        res = await fetch(`${p.base}/chat/completions`, { signal: AbortSignal.timeout(45000),
          method: "POST",
          headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens }),
        });
      }
      if (res.status === 401) { console.error(`  [llm] ${p.name} 401 — removing dead provider`); PROVIDERS.splice(PROVIDERS.indexOf(p), 1); if (!PROVIDERS.length) throw new Error("all providers dead"); continue; }
      if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`${p.name} ${res.status}`);
      const json = await res.json();
      if (p.api === "anthropic") {
        return (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      }
      return json.choices?.[0]?.message?.content || "";
    } catch (e) {
      if (attempt === 7) throw e;
      console.error(`  [llm] ${e.message} — rotating provider`);
      await sleep(2000);
    }
  }
  throw new Error("LLM failed after 8 attempts");
}

const parseJsonLoose = (text) => {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

const REWRITE_PROMPT = (batch) => `You fix a subtle flaw in quiz questions: the CORRECT answer is noticeably longer than the wrong options, which lets players guess by length.

For EACH question below, rewrite ONLY the three WRONG options so that all four options have SIMILAR character lengths. The correct answer's character count is given — each rewritten wrong option MUST be between (count - 4) and (count + 4) characters. Count characters precisely.

Keep every rewritten option:
- clearly WRONG (same wrong answer as before, just reworded/re-lengthened)
- plausible-sounding for someone who doesn't know the topic
- same general style as the question

NEVER change the correct option's text or position. Never change the question.

Questions:
${batch.map((q, i) => {
  const ci = "ABCD".indexOf(q.correct_option);
  const cLen = (q.options[ci] || "").length;
  return `${i + 1}. "${q.question}"
   Options (D=correct, correct length = ${cLen} chars): ${JSON.stringify(q.options.map((o, j) => `${"ABCD"[j]}: ${o}`))}
   Correct: ${"ABCD"[q.correct_option]}
   → Each of the three WRONG options must be ${cLen - 4}-${cLen + 4} characters long.`;
}).join("\n\n")}

Respond with ONLY a JSON array, one object per question, in order:
[{"i":1,"options":["...","...","...","..."]}, ...]`;

function isFlagged(opts, correct) {
  if (!Array.isArray(opts) || opts.length !== 4) return false;
  const ci = "ABCD".indexOf(correct);
  if (ci < 0) return false;
  const lens = opts.map((o) => (o || "").length);
  const correctLen = lens[ci];
  const rest = lens.filter((_, j) => j !== ci);
  const maxRest = Math.max(...rest);
  return correctLen - maxRest >= GAP;
}

// Load everything flagged
let from = 0;
const flagged = [];
let scanned = 0;
console.log("Scanning bank for length-tells...");
for (;;) {
  const { data, error } = await db.from("questions").select("id,question,options,correct_option,category").range(from, from + 999);
  if (error) { console.error(`Load error: ${error.message}`); process.exit(1); }
  if (!data?.length) break;
  for (const q of data) {
    scanned++;
    if (isFlagged(q.options, q.correct_option)) flagged.push(q);
  }
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Scanned ${scanned}. Flagged: ${flagged.length}`);
let work = flagged;
if (MAX > 0 && work.length > MAX) work = work.slice(0, MAX);

const stats = { fixed: 0, skipped: 0, failed: 0 };
let workIdx = 0;

async function worker(id) {
  await sleep(id * 1500);
  while (true) {
    const i = workIdx;
    if (i >= work.length) return;
    workIdx++;
    const batch = work.slice(i * 10, i * 10 + 10);
    if (!batch.length) continue;
    try {
      const raw = await llm([{ role: "user", content: REWRITE_PROMPT(batch) }]);
      const out = parseJsonLoose(raw) || [];
      const updates = [];
      for (let j = 0; j < batch.length; j++) {
        const q = batch[j];
        const r = out.find((v) => String(v?.i) === String(j + 1));
        if (!r?.options || r.options.length !== 4) { stats.skipped++; continue; }
        const ci = "ABCD".indexOf(q.correct_option);
        const correctNorm = norm(q.options[ci]);
        // Locate the correct answer ANYWHERE in the returned options (models
        // reorder), then rebuild the array with the correct text pinned to
        // its original position — keeps correct_option letter valid.
        const correctIdx = r.options.findIndex((o) => norm(o) === correctNorm);
        if (correctIdx < 0) { stats.skipped++; continue; } // model touched the correct answer — reject
        const wrongs = r.options.filter((_, x) => x !== correctIdx).map((o) => String(o).trim());
        if (wrongs.some((o) => !o)) { stats.skipped++; continue; }
        if (new Set([correctNorm, ...wrongs.map(norm)]).size !== 4) { stats.skipped++; continue; }
        const newOptions = q.options.map((orig, x) => (x === ci ? orig : wrongs.pop()));
        const lens = newOptions.map((o) => o.length);
        const still = lens[ci] - Math.max(...lens.filter((_, x) => x !== ci));
        const oldGap = (q.options[ci] || "").length - Math.max(...q.options.filter((_, x) => x !== ci).map((o) => (o || "").length));
        if (still >= GAP && still >= oldGap) { stats.skipped++; continue; } // no improvement
        if (still > 0) console.log(`  improved: gap ${oldGap} -> ${still} (id ${q.id})`);
        updates.push({ id: q.id, options: newOptions });
      }
      for (const u of updates) {
        const { error } = await db.from("questions").update({ options: u.options }).eq("id", u.id);
        if (error) { console.error(`  update fail: ${error.message}`); stats.failed++; continue; }
        stats.fixed++;
      }
      console.log(`batch: +${updates.length} fixed | total fixed:${stats.fixed} skip:${stats.skipped} fail:${stats.failed} | ${i + batch.length}/${work.length}`);
    } catch (e) {
      console.error(`batch error: ${e.message}`);
      stats.failed += batch.length;
    }
  }
}

await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));
console.log(`DONE. fixed:${stats.fixed} skipped:${stats.skipped} failed:${stats.failed} of ${work.length} flagged`);
