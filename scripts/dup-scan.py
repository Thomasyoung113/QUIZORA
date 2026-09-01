import os, json, time, urllib.request, collections, re

KEY = None
with open(os.path.expanduser("~/bghjs/.env.local")) as f:
    for line in f:
        if line.startswith("SUPABASE_SERVICE_ROLE_KEY="):
            KEY = line.strip().split("=", 1)[1]
REF = "jemvqhvpnlyrlazvkiro"
BASE = f"https://{REF}.supabase.co/rest/v1/questions"

texts = []
page = 0
while True:
    url = f"{BASE}?select=id,question&order=id.asc"
    req = urllib.request.Request(url, headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}",
        "Range": f"{page*1000}-{page*1000+999}",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read())
    if not rows:
        break
    texts.extend(rows)
    page += 1
    if page % 10 == 0:
        print(f"loaded {len(texts)}", flush=True)
    if len(rows) < 1000:
        break

print(f"total rows: {len(texts)}")

def norm(q):
    return re.sub(r"[^a-z0-9]", "", q.lower().strip())

groups = collections.defaultdict(list)
for r in texts:
    groups[norm(r["question"])].append(r)

dupes = {k: v for k, v in groups.items() if len(v) > 1}
print(f"\nexact-duplicate groups: {len(dupes)}")
total_extra = sum(len(v) - 1 for v in dupes.values())
print(f"redundant rows to delete: {total_extra}\n")

ids_to_delete = []
for k, v in sorted(dupes.items(), key=lambda x: -len(x[1])):
    print(f"[x{len(v)}] {v[0]['question'][:90]}")
    for r in v[1:]:
        print(f"      dup id={r['id']}")
    ids_to_delete.extend(str(r["id"]) for r in v[1:])

if ids_to_delete:
    with open(os.path.expanduser("~/bghjs/dupes-to-delete.json"), "w") as f:
        json.dump(ids_to_delete, f)
    print(f"\nsaved {len(ids_to_delete)} dup ids -> ~/bghjs/dupes-to-delete.json (NOT deleted yet)")
else:
    print("\nBank clean — no exact duplicates.")
