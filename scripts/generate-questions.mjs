// LLM question generation pipeline for QUIZORA.
// Usage: node scripts/generate-questions.mjs [targetCount] [category]
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
const LLM_KEY = env.LLM_API_KEY;
const LLM_BASE = env.LLM_BASE_URL || "https://api.b.ai/v1";
const LLM_MODEL = env.LLM_MODEL || "glm-5.3-flash";

if (!LLM_KEY) { console.error("Missing LLM_API_KEY in .env.local"); process.exit(1); }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const targetCount = parseInt(process.argv[2] || "500", 10);
const onlyCategory = process.argv[3] || null;

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

async function llm(messages, maxTokens = 8000) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: maxTokens }),
    });
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
  }
  throw new Error("LLM rate-limited after 6 retries");
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

const FACTCHECK_PROMPT = (q) => `You are a skeptical fact-checker for a trivia game. Try to DISPROVE this question.

Question: "${q.question}"
Options: ${JSON.stringify(q.options)}
Claimed correct: ${q.correct} (${q.options["ABCD".indexOf(q.correct)]})

Check: (1) Is the claimed answer actually correct? (2) Is any OTHER option also defensible? (3) Is the wording ambiguous?

Respond with ONLY JSON: {"verdict":"pass|fail","reason":"one short sentence"}`;

async function main() {
  // Build work queue
  const work = [];
  for (const [cat, subs] of Object.entries(CATEGORIES)) {
    if (onlyCategory && cat !== onlyCategory) continue;
    for (const sub of subs) work.push({ cat, sub, rounds: Math.ceil((targetCount * (sub ? 1 : 1)) / (Object.keys(CATEGORIES).length * subs.length) / 10) });
  }

  const { data: existing } = await db.from("questions").select("question");
  const seen = new Set((existing ?? []).map((q) => norm(q.question)));
  console.log(`Existing questions: ${seen.size}`);

  let generated = 0, passed = 0, failed = 0, dupes = 0, inserted = 0;

  for (const { cat, sub, rounds } of work) {
    for (let r = 0; r < rounds; r++) {
      if (inserted >= targetCount) break;

      // 1. Generate batch of 10
      let raw;
      try {
        raw = await llm([{ role: "user", content: GEN_PROMPT(cat, sub, 10) }]);
      } catch (e) {
        console.error(`Gen failed (${cat}/${sub}): ${e.message}`);
        await sleep(3000);
        continue;
      }
      const questions = parseJsonLoose(raw);
      if (!questions?.length) { console.error(`Parse failed (${cat}/${sub})`); continue; }
      generated += questions.length;

      // 2. Fact-check each individually
      for (const q of questions) {
        if (!q?.question || !Array.isArray(q.options) || q.options.length !== 4 || !"ABCD".includes(q.correct)) { failed++; continue; }
        const key = norm(q.question);
        if (seen.has(key) || key.length < 10) { dupes++; continue; }
        seen.add(key);

        try {
          const fcRaw = await llm([{ role: "user", content: FACTCHECK_PROMPT(q) }], 3000);
          const fc = parseJsonLoose(fcRaw) || JSON.parse(fcRaw.match(/\{[\s\S]*\}/)?.[0] || "null");
          if (fc?.verdict !== "pass") { failed++; console.log(`  FAIL: ${fc?.reason || "?"} — ${q.question.slice(0, 60)}`); continue; }
        } catch (e) {
          console.error(`Fact-check error (skipping question): ${e.message}`);
          failed++;
          continue;
        }

        try {

        const { data: ins, error } = await db.from("questions").upsert({
          question: q.question,
          category: cat,
          subcategory: sub,
          difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
          type: "mcq",
          options: q.options,
          correct_option: q.correct,
          explanation: q.explanation || null,
          source: `${LLM_MODEL}+factcheck`,
          source_url: null,
          license: null,
          status: "approved",
        }, { onConflict: "question", ignoreDuplicates: true }).select("id");
        } catch (e) {
          console.error(`Insert failed (network, skipping): ${e.message}`);
          continue;
        }
        if (error) { console.error(`Insert error: ${error.message}`); continue; }
        if (!ins?.length) { dupes++; continue; } // raced with another importer
        passed++;
        inserted++;
      }
      console.log(`[${cat}/${sub}] round ${r + 1}/${rounds} — gen:${generated} pass:${passed} fail:${failed} dup:${dupes} inserted:${inserted}/${targetCount}`);
    }
    if (inserted >= targetCount) break;
  }

  console.log(`DONE. generated:${generated} factcheck-passed+inserted:${inserted} failed:${failed} dupes:${dupes}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
