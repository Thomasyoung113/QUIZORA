#!/data/data/com.termux/files/usr/bin/bash
# Refill categories to 3k using Bynara only (2 workers = its safe concurrency).
cd /data/data/com.termux/files/home/bghjs
while true; do
  RUNNING=$(ps aux | grep generate-questions | grep -v grep | wc -l)
  if [ "$RUNNING" -eq 0 ]; then
    echo "$(date +%H:%M) keeper-bynara: relaunching..."
    ONLY_PROVIDERS=bynara PARALLEL=2 PER_CATEGORY=3000 \
      nohup node scripts/generate-questions.mjs >> "$HOME/bghjs/gen-bynara.log" 2>&1 &
    sleep 30
  fi
  sleep 60
done
