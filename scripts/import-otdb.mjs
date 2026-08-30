// Import Open Trivia DB (multiple-choice) into QUIZORA.
// Usage: node scripts/import-otdb.mjs
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// OTDB license: CC-BY-SA 4.0 (attribution on /legal).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]])
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// QUIZORA category <- OTDB category id
const CATEGORY_MAP = {
  9: "General Knowledge", // General Knowledge
  10: "Culture", // Books
  11: "Culture", // Film
  12: "Culture", // Music
  13: "Culture", // Musicals & Theatres
  14: "Culture", // Television
  15: "Culture", // Video Games
  16: "Culture", // Board Games
  17: "Nature", // Science & Nature
  18: "Technology", // Computers
  19: "Science", // Mathematics
  20: "Culture", // Mythology
  21: "Culture", // Sports
  22: "Geography",
  23: "History",
  24: "Culture", // Politics
  25: "Culture", // Art
  26: "Culture", // Celebrities
  27: "Nature", // Animals
  28: "Technology", // Vehicles
  29: "Culture", // Comics
  30: "Technology", // Gadgets
  31: "Culture", // Anime & Manga
  32: "Culture", // Cartoons
};

const dec = (b64) => Buffer.from(b64, "base64").toString("utf8");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: existing } = await db.from("questions").select("question");
  const seen = new Set((existing ?? []).map((q) => norm(q.question)));
  console.log(`Existing questions: ${seen.size}`);

  const tokenData = await (async () => {
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch("https://opentdb.com/api_token.php?command=request");
        const j = await r.json();
        if (j.token) return j;
      } catch {}
      await sleep(3000);
    }
    throw new Error("Could not get OTDB token after 5 tries");
  })();
  const token = tokenData.token;
  console.log("Session token acquired");

  const batch = [];
  const BATCH_SIZE = 100;
  let imported = 0, dupes = 0, total = 0;

  for (const [catId, category] of Object.entries(CATEGORY_MAP)) {
    let exhausted = false;
    while (!exhausted) {
      await sleep(5200); // OTDB rate limit
      const url = `https://opentdb.com/api.php?amount=50&category=${catId}&type=multiple&encode=base64&token=${token}`;
      let json;
      try {
        json = await fetch(url).then((r) => r.json());
      } catch (e) {
        console.error(`Fetch failed for cat ${catId}: ${e.message}`);
        break;
      }
      if (json.response_code === 4) { exhausted = true; continue; }
      if (json.response_code !== 0 || !json.results) { exhausted = true; continue; }

      for (const q of json.results) {
        total++;
        const question = dec(q.question);
        const key = norm(question);
        if (seen.has(key) || key.length < 10) { dupes++; continue; }
        seen.add(key);

        const correct = dec(q.correct_answer);
        const wrong = q.incorrect_answers.map(dec);
        // Shuffle correct into the options deterministically-random
        const options = [...wrong];
        const pos = Math.floor(Math.random() * 4);
        options.splice(pos, 0, correct);
        const letters = ["A", "B", "C", "D"];
        const correct_option = letters[pos];

        batch.push({
          question,
          category,
          subcategory: null,
          difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
          type: "mcq",
          options,
          correct_option,
          explanation: null,
          source: "OpenTDB",
          source_url: "https://opentdb.com",
          license: "CC-BY-SA-4.0",
          status: "approved",
        });

        if (batch.length >= BATCH_SIZE) {
          const { error } = await db.from("questions").insert(batch).select("id");
          if (error) { console.error("Insert error:", error.message); process.exit(1); }
          imported += batch.length;
          batch.length = 0;
          console.log(`  imported ${imported} (cat ${catId} done so far)`);
        }
      }
    }
    console.log(`Category ${catId} (${category}) done — total so far: ${total}, dupes: ${dupes}`);
  }

  if (batch.length) {
    const { error } = await db.from("questions").insert(batch).select("id");
    if (error) { console.error("Insert error:", error.message); process.exit(1); }
    imported += batch.length;
  }
  console.log(`DONE. Fetched: ${total}, imported: ${imported}, skipped dupes/short: ${dupes}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
