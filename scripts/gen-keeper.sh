#!/data/data/com.termux/files/usr/bin/bash
# Auto-relaunch question generator when it exits, until all categories hit 3k.
cd /data/data/com.termux/files/home/bghjs
while true; do
  RUNNING=$(ps aux | grep generate-questions | grep -v grep | wc -l)
  if [ "$RUNNING" -eq 0 ]; then
    echo "$(date +%H:%M) keeper: relaunching..."
    ONLY_PROVIDERS=agentrouter-glm,agentrouter-ds PARALLEL=16 PER_CATEGORY=3000 \
      nohup node scripts/generate-questions.mjs >> "$HOME/bghjs/gen-ar.log" 2>&1 &
    sleep 30
  fi
  sleep 60
done
