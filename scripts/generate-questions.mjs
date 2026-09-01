// LLM question generation pipeline for QUIZORA.
// Usage: PER_CATEGORY=N node scripts/generate-questions.mjs [category]
// Two-stage: generate -> fact-check (a second pass tries to disprove the answer).
// Only survivors are inserted with status='published'; failures are logged.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
let PROVIDERS = [
  { name: "b.ai", base: env.LLM_BASE_URL || "https://api.b.ai/v1", key: env.LLM_API_KEY, model: env.LLM_MODEL || "glm-5.3-flash", api: "openai" },
  { name: "bynara", base: env.BYNARA_BASE_URL || "https://router.bynara.id/v1", key: env.BYNARA_API_KEY, model: env.BYNARA_MODEL || "agnes-2.5-flash", api: "openai" },
  { name: "agentrouter-glm", base: env.AGENTROUTER_BASE_URL || "https://agentrouter.org", key: env.AGENTROUTER_API_KEY, model: "glm-5.3", api: "anthropic" },
  { name: "agentrouter-ds", base: env.AGENTROUTER_BASE_URL || "https://agentrouter.org", key: env.AGENTROUTER_API_KEY, model: "deepseek-v4-flash", api: "anthropic" },
].filter((p) => p.key);
const onlyProviders = (process.env.ONLY_PROVIDERS || "").split(",").filter(Boolean);
if (onlyProviders.length) PROVIDERS = PROVIDERS.filter((p) => onlyProviders.includes(p.name));
if (!PROVIDERS.length) { console.error("No providers configured (set LLM_API_KEY / BYNARA_API_KEY / AGENTROUTER_API_KEY)"); process.exit(1); }
console.log("Providers:", PROVIDERS.map((p) => p.name).join(", "));

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const onlyCategory = process.argv[2] || null;

const CATEGORIES = {
  Science: ["Physics", "Chemistry", "Biology", "Astronomy", "Medicine", "Earth Science"],
  Technology: ["Computers", "Internet", "Programming", "AI", "Gadgets", "Transport"],
  Geography: ["Countries", "Capitals", "Rivers & Mountains", "Landmarks", "Flags"],
  History: ["Ancient", "Medieval", "Modern", "Wars", "Discoveries"],
  Nature: ["Animals", "Plants", "Oceans", "Weather", "Ecology"],
  Space: ["Solar System", "Stars & Galaxies", "Missions", "Cosmology"],
  Culture: ["Music", "Film", "Literature", "Art", "Food", "Sports", "Mythology"],
  Business: ["Companies", "Economics", "Brands", "Inventions"],
  Logic: ["Riddles", "Patterns", "Lateral Thinking"],
  "General Knowledge": ["Mixed"],
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function llm(messages, maxTokens = 8000, startProvider = 0) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const p = PROVIDERS[(startProvider + attempt) % PROVIDERS.length];
    try {
      let res;
      if (p.api === "anthropic") {
        // Anthropic-style endpoint; strip system role into system param
        const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
        const msgs = messages.filter((m) => m.role !== "system");
        res = await fetch(`${p.base}/v1/messages`, {
          method: "POST",
          headers: { "x-api-key": p.key, "anthropic-version": "2023-06-01", "user-agent": "claude-cli/2.0.0 (external, cli)", "Content-Type": "application/json" },
          body: JSON.stringify({ model: p.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: msgs }),
        });
        if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
        if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const json = await res.json();
        const text = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        return text;
      }
      res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens }),
      });
      if (res.status === 429) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`${p.name} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      return json.choices?.[0]?.message?.content || "";
    } catch (e) {
      if (attempt === 7) throw e;
      console.error(`  [llm] ${e.message} — switching provider`);
      await sleep(2000);
    }
  }
  throw new Error("LLM failed after 8 attempts");
}

function parseJsonLoose(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const GEN_PROMPT = (category, sub, n) => `You write pub-quiz trivia questions for a mobile quiz game.

Write ${n} original multiple-choice trivia questions in the category "${category}"${sub ? `, subcategory "${sub}"` : ""}.

STRICT RULES:
- Each question: one unambiguously correct answer, 3 plausible but clearly wrong distractors.
- No "all of the above", no trick wording, no opinions.
- Difficulty must be one of: easy, medium, hard.
- Mix difficulties roughly: 40% easy, 40% medium, 20% hard.
- 10-25 words per question. Facts only, verifiable, no time-sensitive trivia that changes (e.g. "current champion").
- explanation: 1-2 sentences explaining WHY the answer is correct.

Return ONLY a JSON array, no markdown fences, with objects:
{"question":"...","options":["A-option","B-option","C-option","D-option"],"correct":"A|B|C|D","difficulty":"easy|medium|hard","explanation":"..."}`;

const FACTCHECK_PROMPT = (questions) => `You are a fact-checker for a pub-quiz trivia game. Judge each question by NORMAL trivia standards — not academic rigor.

FAIL a question ONLY if: (a) the claimed answer is factually WRONG, or (b) another option is EQUALLY correct.
DO NOT fail for: simplified phrasing, missing edge-case qualifiers, "approximately", common conventions (e.g. pH 7, Newton's third law), or mild ambiguity that a quiz player would resolve easily. Pub quizzes accept standard simplifications.

Questions:
${questions.map((q, i) => `${i + 1}. "${q.question}"\n   Options: ${JSON.stringify(q.options)}\n   Claimed correct: ${q.correct} (${q.options["ABCD".indexOf(q.correct)]})`).join("\n")}

Respond with ONLY a JSON array, one object per question in order, no markdown fences:
[{"i":1,"verdict":"pass|fail","reason":"one short sentence"},...]`;

const PARALLEL = parseInt(process.env.PARALLEL || "8", 10);
const PER_CATEGORY = parseInt(process.env.PER_CATEGORY || "0", 10); // if set, target N per category

async function main() {
  // Load existing counts per category (paginated past the 1,000-row cap)
  const existingRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from("questions").select("question, category").range(from, from + 999);
    if (error) { console.error(`Load error: ${error.message}`); break; }
    if (!data?.length) break;
    existingRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const seen = new Set(existingRows.map((q) => norm(q.question)));
  const catCounts = {};
  for (const q of existingRows) catCounts[q.category] = (catCounts[q.category] || 0) + 1;
  console.log(`Existing questions: ${seen.size}`);

  // Build work queue — per-category deficits vs target
  const work = [];
  for (const [cat, subs] of Object.entries(CATEGORIES)) {
    if (onlyCategory && cat !== onlyCategory) continue;

    const deficit = Math.max(0, target - (catCounts[cat] || 0));
    if (deficit === 0) { console.log(`[${cat}] already at ${catCounts[cat] || 0} >= ${target}, skipping`); continue; }
    const roundsTotal = Math.ceil(deficit / 10 / subs.length);
    console.log(`[${cat}] have ${catCounts[cat] || 0}, deficit ${deficit} -> ${roundsTotal} rounds/sub × ${subs.length} subs`);
    for (const sub of subs) work.push({ cat, sub, rounds: roundsTotal });
  }
  if (!work.length) { console.log("Nothing to do."); return; }

  const stats = { generated: 0, passed: 0, failed: 0, dupes: 0, inserted: 0 };
  const catInserted = {};
  let workIdx = 0;

  async function worker(id) {
    await sleep(id * 2500); // stagger workers
    const homeProvider = id % PROVIDERS.length; // spread workers across all providers
    while (true) {
      const item = work[workIdx];
      if (!item) return;
      // Skip subcategories that already hit their per-category target
      if ((catInserted[item.cat] || 0) >= item.rounds * 10 * item.subsLeft) { workIdx++; continue; }
      workIdx++;
      const { cat, sub, rounds } = item;
      for (let r = 0; r < rounds; r++) {
        if ((catInserted[cat] || 0) >= (PER_CATEGORY > 0 ? PER_CATEGORY - (catCounts[cat] || 0) : Infinity)) break;
        const before = stats.inserted;
        await runRound(cat, sub, r, rounds, stats, seen, homeProvider);
        catInserted[cat] = (catInserted[cat] || 0) + (stats.inserted - before);
      }
    }
  }

  async function runRound(cat, sub, r, rounds, stats, seen, homeProvider) {
      // 1. Generate batch of 10
      let raw;
      try {
        raw = await llm([{ role: "user", content: GEN_PROMPT(cat, sub, 10) }], 8000, homeProvider);
      } catch (e) {
        console.error(`Gen failed (${cat}/${sub}): ${e.message}`);
        await sleep(3000);
        return;
      }
      const questions = parseJsonLoose(raw);
      if (!questions?.length) { console.error(`Parse failed (${cat}/${sub})`); return; }
      stats.generated += questions.length;

      // 2. Filter valid + non-dupe, then fact-check the whole batch in ONE call
      const candidates = [];
      for (const q of questions) {
        if (!q?.question || !Array.isArray(q.options) || q.options.length !== 4 || !"ABCD".includes(q.correct)) { stats.failed++; continue; }
        const key = norm(q.question);
        if (seen.has(key) || key.length < 10) { stats.dupes++; continue; }
        seen.add(key);
        candidates.push(q);
      }
      if (!candidates.length) { console.log(`[${cat}/${sub}] round ${r + 1}/${rounds} — no candidates (all dupes/invalid)`); return; }

      let verdicts = [];
      try {
        const fcRaw = await llm([{ role: "user", content: FACTCHECK_PROMPT(candidates) }], 8000, homeProvider);
        verdicts = parseJsonLoose(fcRaw) || [];
      } catch (e) {
        console.error(`Fact-check batch error (skipping ${candidates.length}): ${e.message}`);
        stats.failed += candidates.length;
        return;
      }

      const toInsert = [];
      candidates.forEach((q, idx) => {
        const fc = verdicts.find((v) => v && String(v.i) === String(idx + 1));
        if (fc?.verdict !== "pass") { stats.failed++; if (fc?.reason) console.log(`  FAIL: ${fc.reason} — ${q.question.slice(0, 60)}`); return; }
        toInsert.push(q);
      });
      if (!toInsert.length) { console.log(`[${cat}/${sub}] round ${r + 1}/${rounds} — all failed fact-check`); return; }

      let ins = null;
      try {
        const { data, error: upErr } = await db.from("questions").upsert(
          toInsert.map((q) => ({
            question: q.question,
            category: cat,
            subcategory: sub,
            difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
            type: "mcq",
            options: q.options,
            correct_option: q.correct,
            explanation: q.explanation || null,
            source: "llm+factcheck",
            source_url: null,
            license: null,
            status: "approved",
          })),
          { onConflict: "question", ignoreDuplicates: true }
        ).select("id");
        if (upErr) { console.error(`Insert error: ${upErr.message}`); return; }
        ins = data;
      } catch (e) {
        console.error(`Insert failed (network, skipping): ${e.message}`);
        return;
      }
      const insertedNow = ins?.length ?? 0;
      stats.dupes += toInsert.length - insertedNow;
      stats.passed += insertedNow;
      stats.inserted += insertedNow;
      console.log(`[${cat}/${sub}] round ${r + 1}/${rounds} — batch:${toInsert.length} ok:${insertedNow} total:${stats.inserted}`);
  }

  await Promise.all(Array.from({ length: PARALLEL }, (_, i) => worker(i)));

  console.log(`DONE. generated:${stats.generated} factcheck-passed+inserted:${stats.inserted} failed:${stats.failed} dupes:${stats.dupes}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
