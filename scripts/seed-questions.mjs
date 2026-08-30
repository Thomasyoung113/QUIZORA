// Seeds Supabase `questions` table from data/questions.json
// Usage: node scripts/seed-questions.mjs
// Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or .env.local)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// minimal .env.local loader (Termux-friendly, no dotenv dep)
try {
  for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { questions } = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "questions.json"), "utf8")
);

// Upsert on content hash to stay idempotent
const rows = questions.map((q) => ({
  question: q.question,
  category: q.category,
  subcategory: q.subcategory ?? null,
  difficulty: q.difficulty,
  options: q.options,
  correct_option: q.correct_option,
  explanation: q.explanation,
  source: q.source_name ?? null,
  source_url: q.source_url ?? null,
  license: q.license ?? "CC-BY-SA",
  status: q.status ?? "approved",
}));

let ok = 0, fail = 0;
const BATCH = 50;
for (let i = 0; i < rows.length; i += BATCH) {
  const { error } = await db.from("questions").upsert(rows.slice(i, i + BATCH), {
    onConflict: "question",
    ignoreDuplicates: false,
  });
  if (error) {
    fail += rows.slice(i, i + BATCH).length;
    console.error("Batch", i / BATCH, "failed:", error.message);
  } else ok += Math.min(BATCH, rows.length - i);
}
console.log(`Seeded ${ok}/${rows.length} questions${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
