#!/usr/bin/env bash
# Auto-grappille Spotify — reprend le dry-run dès que le cap dédié se lève.
# Probe /90min → quand DRAINÉ, grappille le reste du catalogue (G3→G10, idx 20-94).
# Resume-safe (CSV : saute les tracks déjà matchés). Auto-stop sur cap (exit 42)
# → re-sleep + re-probe. Tourne jusqu'à 100% puis s'arrête seul.
# Jetable (campagne d'enrichissement). Log : /tmp/spotify-grappille.log
set -u
cd "/Users/thomaspinon/Documents/Claude Code/tutti/backend" || exit 1
LOG=/tmp/spotify-grappille.log
START=20      # G3 — G1+G2 (idx 0-19) déjà dans le CSV
COUNT=75      # idx 20..94 = tout le reste du catalogue (resume-safe)
SLEEP=5400    # 90 min entre probes / après un cap
ts() { date '+%Y-%m-%d %H:%M:%S'; }

echo "$(ts) === GRAPPILLE START (chunk $START +$COUNT, pid $$) ===" >> "$LOG"
while true; do
  npx tsx scripts/spotifyProbe.ts >> "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "$(ts) DRAINED → run chunk $START +$COUNT" >> "$LOG"
    npx tsx scripts/spotifyMatchDryrun.ts chunk "$START" "$COUNT" >> "$LOG" 2>&1
    rc=$?
    echo "$(ts) chunk exit=$rc" >> "$LOG"
    if [ "$rc" -eq 0 ]; then
      echo "$(ts) ✅ CATALOGUE COMPLET (G3-G10 fini) — STOP." >> "$LOG"
      break
    fi
    # rc=42 = capé en cours de batch (normal) → on attend et on reprend.
  fi
  echo "$(ts) sleep ${SLEEP}s" >> "$LOG"
  sleep "$SLEEP"
done
