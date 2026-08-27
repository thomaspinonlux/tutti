#!/usr/bin/env bash
# Grappille Spotify — SEULEMENT les tracks récents jamais swept (hors-groupe,
# ajoutés après la campagne G1-G10). Réutilise la mécanique du grappille campagne :
# probe /90min → si DRAINÉ, lance le matcher dry-run en mode chunk sur TOUTES les
# playlists (0..+COUNT). Le matcher filtre déjà spotify_id=null ET skippe via la
# seen-set du CSV (auto-ok + review + no-match déjà testés) → ne teste donc QUE les
# ~729 unswept. Round-robin 3 apps dry-run + throttle 1 req/s + retry-after (pas de
# retry brutal) sont DANS spotifyMatchDryrun.ts. Resume-safe. Auto-stop cap (exit 42)
# → re-sleep + re-probe. Laisse intacts les 85 review + 193 no-match (jamais ré-écrits).
# Jetable. Log : /tmp/spotify-grappille-recent.log
set -u
cd "/Users/thomaspinon/Documents/Claude Code/tutti/backend" || exit 1
LOG=/tmp/spotify-grappille-recent.log
START=0       # depuis le début de la liste triée → couvre toutes les playlists
COUNT=120     # ≥ 111 playlists actuelles ; slice clamp. Seen-set skip le déjà-fait.
SLEEP=5400    # 90 min entre probes / après un cap
ts() { date '+%Y-%m-%d %H:%M:%S'; }

echo "$(ts) === GRAPPILLE RECENT START (chunk $START +$COUNT, pid $$) ===" >> "$LOG"
while true; do
  npx tsx scripts/spotifyProbe.ts >> "$LOG" 2>&1
  if [ $? -eq 0 ]; then
    echo "$(ts) DRAINED → run chunk $START +$COUNT (unswept only)" >> "$LOG"
    npx tsx scripts/spotifyMatchDryrun.ts chunk "$START" "$COUNT" >> "$LOG" 2>&1
    rc=$?
    echo "$(ts) chunk exit=$rc" >> "$LOG"
    if [ "$rc" -eq 0 ]; then
      echo "$(ts) ✅ UNSWEPT COMPLET — STOP." >> "$LOG"
      break
    fi
    # rc=42 = capé en cours (normal) → attendre et reprendre (resume-safe).
  fi
  echo "$(ts) sleep ${SLEEP}s" >> "$LOG"
  sleep "$SLEEP"
done
