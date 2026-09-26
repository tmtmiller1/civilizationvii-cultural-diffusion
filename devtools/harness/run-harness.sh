#!/bin/zsh
# run-harness.sh <game-script.js> [save file name] [label] [timeout seconds]
#
# Hands-free Cultural Diffusion harness run, following the emigration probe runner
# (tower_mods/emigration/devtools/engine-probe/run-probe.sh). It:
#   - refuses to start if the game is already running, or if another session's probe/harness mod is installed
#     (a second harness hijacks the launch and contaminates both runs)
#   - backs up the player's autosaves, and puts them back if the run churned the 10-slot rotation
#   - remembers every cultural-diffusion registry row's Disabled flag and restores it exactly afterwards
#   - deploys the REPO copy of the mod into Mods/ with AffectsSavedGames=0 and debug: true patched into the
#     DEPLOYED copy only (the repo is never edited)
#   - installs the throwaway cd-harness mod with the chosen game script, launches via Steam, waits for DONE,
#     collects the [CDH] log, any crash report, then quits and restores everything
#
# Usage: zsh run-harness.sh cdh-game-run13.js AugustusAnt136.Civ7Save run13 1200
set -u
SCRIPT="${1:?game script, e.g. cdh-game-run13.js}"
SAVE="${2:-AugustusAnt136.Civ7Save}"
LABEL="${3:-run}"
TIMEOUT="${4:-1200}"

S="$HOME/Library/Application Support/Civilization VII"
DB="$S/Mods.sqlite"; MODS="$S/Mods"; LOG="$S/Logs/UI.log"; AUTO="$S/Saves/Single/auto"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DEST="$MODS/cultural-diffusion"; MI="$DEST/cultural-diffusion.modinfo"
BAK="$S/cd-harness-backup/auto-$LABEL"
say() { echo "[$(date +%H:%M:%S)] $*"; }

[ -f "$HERE/$SCRIPT" ] || { say "missing script $HERE/$SCRIPT"; exit 1; }
[ -f "$S/Saves/Single/$SAVE" ] || { say "missing save $S/Saves/Single/$SAVE"; exit 1; }
pgrep -x CivilizationVII >/dev/null && { say "Civ VII is ALREADY RUNNING - another session may be using it. Stop here."; exit 1; }
FOREIGN=$(ls "$MODS" 2>/dev/null | grep -iE "probe|harness" | grep -v "^cd-harness$" | tr '\n' ' ')
[ -n "$FOREIGN" ] && { say "another session's probe mod(s) are installed: $FOREIGN"; say "move them out first, or they hijack this launch"; exit 1; }

# AI_VERBOSE=1 turns on the engine's AI scoring logs (AppOptions.txt AIVerboseLogging), which is what makes
# the AI_ConstructibleBroker CSV tail appear - the evidence CLAUDE.md calls for on an AI-turn crash. The file
# is the player's, so it is backed up and restored. Mechanism proven by firaxis-bug-reports/repro/run-repro.sh.
OPTS="$S/AppOptions.txt"
if [ "${AI_VERBOSE:-0}" = "1" ] && [ -f "$OPTS" ]; then
  cp -p "$OPTS" "$OPTS.cdh-bak"
  if grep -q "^AIVerboseLogging" "$OPTS"; then sed -i '' 's/^AIVerboseLogging .*/AIVerboseLogging 1/' "$OPTS";
  else sed -i '' 's/^;AIVerboseLogging 0/AIVerboseLogging 1/' "$OPTS"; fi
  say "AIVerboseLogging -> $(grep -c '^AIVerboseLogging 1' "$OPTS") (AppOptions.txt backed up)"
fi

rm -rf "$BAK"; mkdir -p "$BAK"; cp -p "$AUTO"/*.Civ7Save "$BAK"/ 2>/dev/null
say "autosaves backed up: $(ls "$BAK" 2>/dev/null | wc -l | tr -d ' ')"

# Restore by the VALUE, not the row id: redeploying the mod folder makes the game rescan and mint a NEW
# ModRowId, so a restore keyed on the pre-run row id misses the live row and leaves the mod enabled
# (watched on run 13: row 639 before, row 1015 after).
# NO_MOD=1 runs the harness with Cultural Diffusion left DISABLED - the only honest A/B control, because
# asking the mod to stand down from a script does not work: applyTunableOverrides() pulls saved settings into
# CONFIG on every pass, so `CONFIG.diffusionEnabled = false` set by a harness is clobbered within a turn
# (watched: run 31 was meant to be a control and finished holding 37 claims). A control script must import
# nothing from the mod.
PRE_DISABLED=$(sqlite3 "$DB" "select max(Disabled) from Mods where ModId='cultural-diffusion'")
[ -n "$PRE_DISABLED" ] || PRE_DISABLED=1
say "registry before: $(sqlite3 "$DB" "select ModRowId||'='||Disabled from Mods where ModId='cultural-diffusion'" | tr '\n' ' ') (restoring Disabled=$PRE_DISABLED afterwards)"

# Deploy the repo copy, then patch the DEPLOYED files only.
rm -rf "$DEST"; mkdir -p "$DEST"
cp "$REPO/cultural-diffusion.modinfo" "$DEST/"
cp -R "$REPO/ui" "$DEST/"
[ -d "$REPO/text" ] && cp -R "$REPO/text" "$DEST/"
[ -d "$REPO/data" ] && cp -R "$REPO/data" "$DEST/"
grep -q AffectsSavedGames "$MI" || sed -i '' -E 's#(<Version>[^<]+</Version>)#\1\n        <AffectsSavedGames>0</AffectsSavedGames>#' "$MI"
sed -i '' -E 's/^([[:space:]]*)debug: false/\1debug: true/' "$DEST/ui/cd-config.js"
# PATCH="<file>|<from>|<to>" edits ONE deployed file, never the repo. Used for defaults that do not live in
# cd-config.js - e.g. the pressure lens, whose default is hardcoded in cd-settings.js, and which has to be off for
# a clean border capture because touching LensManager to disable its layer redraws the yield-icon overlay.
if [ -n "${PATCH:-}" ]; then
  pf="${PATCH%%|*}"; rest="${PATCH#*|}"; pfrom="${rest%%|*}"; pto="${rest##*|}"
  if [ -f "$DEST/$pf" ]; then
    sed -i '' "s|$pfrom|$pto|g" "$DEST/$pf"
    say "patched $pf: '$pfrom' -> '$pto' ($(grep -c "$pto" "$DEST/$pf") hit(s))"
  else say "PATCH target $pf not found"; fi
fi
say "deployed mod: debug=$(grep -c 'debug: true' "$DEST/ui/cd-config.js") affectsSaves0=$(grep -c AffectsSavedGames "$MI")"
if [ "${NO_MOD:-0}" = "1" ]; then
  sqlite3 "$DB" "update Mods set Disabled=1 where ModId='cultural-diffusion'"
  say "NO_MOD=1: Cultural Diffusion left DISABLED for this run (control)"
else
  sqlite3 "$DB" "update Mods set Disabled=0 where ModId='cultural-diffusion'"
fi

rm -rf "$MODS/cd-harness"; mkdir -p "$MODS/cd-harness/ui"
cp "$HERE/cd-harness.modinfo" "$MODS/cd-harness/"
sed -e "s/AugustusAnt136.Civ7Save/$SAVE/" "$HERE/${SHELL_SRC:-cdh-shell.js}" > "$MODS/cd-harness/ui/cdh-shell.js"
cp "$HERE/$SCRIPT" "$MODS/cd-harness/ui/cdh-game.js"
say "harness installed: $SCRIPT on $SAVE"

# UI.log is shared with every other session's probe. Keep a copy before truncating: a previous run's log
# is somebody's only evidence, and this script used to destroy it silently.
if [ -s "$LOG" ]; then
  KEEP="$S/cd-harness-backup/UI-before-$LABEL-$(date +%Y%m%d-%H%M%S).log"
  mkdir -p "$(dirname "$KEEP")"; cp -p "$LOG" "$KEEP"
  say "previous UI.log kept at $KEEP ($(wc -l < "$KEEP" | tr -d ' ') lines)"
fi
: > "$LOG" 2>/dev/null
open steam://rungameid/1295660
n=0; until pgrep -x CivilizationVII >/dev/null; do sleep 2; n=$((n+1)); [ $n -gt 90 ] && { say "GAME DID NOT START"; break; }; done
say "game pid $(pgrep -x CivilizationVII | head -1)"

mkdir -p "$HERE/shots"
t=0; result=timeout; typeset -A shot
while [ $t -lt $TIMEOUT ]; do
  sleep 4; t=$((t+4))
  # Captures: the game script emits "SHOT <name>" when a view is ready. Grab the game WINDOW by id - never the
  # whole display. A full-screen grab once caught the user's Messages window (2026-09-14), so if no game window is
  # listed the shot is SKIPPED and said so, rather than falling back to the screen.
  setopt local_options null_glob
  for name in $(grep -oE "\[CDH\] SHOT [A-Za-z0-9_-]+" "$LOG" 2>/dev/null | awk '{print $3}'); do
    [ -n "${shot[$name]:-}" ] && continue
    shot[$name]=1
    winid=$(swift "$HERE/cdh-winid.swift" 2>/dev/null | awk '$3 > 600' | sort -k3 -n -r | head -1 | awk '{print $1}')
    out="$HERE/shots/$LABEL-$name.png"
    if [ -n "$winid" ]; then
      screencapture -x -o -l "$winid" "$out"
      say "shot $name -> $(ls -la "$out" 2>/dev/null | awk '{print $5}') bytes"
    else
      say "shot $name SKIPPED: no game window listed (refusing a full-display capture)"
    fi
  done
  # Match any harness completion line, not just "run N": the control script emits "DONE harness control
  # finished" and the first version of this grep missed it, leaving a finished game idling until timeout.
  if grep -q "DONE harness " "$LOG" 2>/dev/null; then result=done; sleep 6; break; fi
  if grep -q "LOAD gave up\|cannot load" "$LOG" 2>/dev/null; then result=loadfail; break; fi
  if ! pgrep -x CivilizationVII >/dev/null; then result=crashed; break; fi
done
say "result=$result after ${t}s"

grep "\[CDH\]\|\[CulturalDiffusion\]" "$LOG" | cut -c1-1200 > "$HERE/$LABEL-UI.log"
# The AI scoring logs: the ConstructibleBroker tail names the last-evaluated constructible before a fault.
# setopt nullglob for this loop: zsh ABORTS a for-loop whose glob matches nothing, which silently skipped
# collection on run 32 even though AI_ConstructibleBroker.csv existed.
setopt local_options null_glob
for ai in "$S/Logs/"*onstructible*.csv "$S/Logs/"*AI*.csv "$S/Logs/"*onstructible*.log; do
  [ -f "$ai" ] || continue
  cp -p "$ai" "$HERE/$LABEL-$(basename "$ai")" 2>/dev/null && say "collected $(basename "$ai") ($(wc -l < "$ai" | tr -d ' ') lines)"
done
grep -i "error\|exception" "$LOG" | grep -iv "\[CDH\]\|\[CulturalDiffusion\]" | tail -20 > "$HERE/$LABEL-errors.txt"
if [ "$result" = crashed ]; then
  say "waiting 60s for the crash report to land"   # .ips files appear 20-50s after the fault
  sleep 60
  latest=$(ls -t "$HOME/Library/Logs/DiagnosticReports"/CivilizationVII*.ips 2>/dev/null | head -1)
  [ -n "$latest" ] && { cp "$latest" "$HERE/$LABEL-crash.ips"; say "crash report: $(basename $latest)"; } || say "no .ips found"
fi

pkill -TERM CivilizationVII; sleep 8; pgrep -x CivilizationVII >/dev/null && { sleep 10; pkill -KILL CivilizationVII; }
sqlite3 "$DB" "update Mods set Disabled=$PRE_DISABLED where ModId='cultural-diffusion'"
[ -f "$OPTS.cdh-bak" ] && { mv "$OPTS.cdh-bak" "$OPTS"; say "AppOptions.txt restored"; }
rm -rf "$MODS/cd-harness"
# Redeploy the unpatched repo copy so the next real session runs the shipped config.
rm -rf "$DEST"; mkdir -p "$DEST"; cp "$REPO/cultural-diffusion.modinfo" "$DEST/"; cp -R "$REPO/ui" "$DEST/"
[ -d "$REPO/text" ] && cp -R "$REPO/text" "$DEST/"
[ -d "$REPO/data" ] && cp -R "$REPO/data" "$DEST/"
say "restored: registry $(sqlite3 "$DB" "select ModRowId||'='||Disabled from Mods where ModId='cultural-diffusion'" | tr '\n' ' ') harness present: $([ -d "$MODS/cd-harness" ] && echo yes || echo no) debugPatched: $(grep -c 'debug: true' "$DEST/ui/cd-config.js")"

if [ "$(ls "$AUTO"/*.Civ7Save 2>/dev/null | xargs -n1 basename | sort)" != "$(ls "$BAK" 2>/dev/null | sort)" ]; then
  say "autosaves changed during the run; putting the player's back"
  rm -f "$AUTO"/*.Civ7Save; cp -p "$BAK"/*.Civ7Save "$AUTO"/ 2>/dev/null
fi
say "FINISHED result=$result  log: $HERE/$LABEL-UI.log"
