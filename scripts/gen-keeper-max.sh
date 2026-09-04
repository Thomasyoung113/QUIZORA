#!/data/data/com.termux/files/usr/bin/bash
# Max-throughput refill: b.ai (20 streams) + Bynara (2 streams) run INDEPENDENTLY.
# Each gets its own keeper check so one never blocks the other.
cd /data/data/com.termux/files/home/bghjs

ensure() { # $1=pattern $2=providers $3=parallel $4=log
  if ! pgrep -f "$1" > /dev/null; then
    echo "$(date +%H:%M) keeper-max: launching $2 (P=$3)"
    ONLY_PROVIDERS="$2" PARALLEL="$3" PER_CATEGORY=3000 \
      setsid nohup node scripts/generate-questions.mjs >> "$4" 2>&1 < /dev/null &
  fi
}

while true; do
  ensure "ONLY_PROVIDERS=b.ai" "b.ai" 6 "$HOME/bghjs/gen-bai.log"
  sleep 20
  ensure "ONLY_PROVIDERS=bynara" "bynara" 2 "$HOME/bghjs/gen-bynara.log"
  sleep 60
done
