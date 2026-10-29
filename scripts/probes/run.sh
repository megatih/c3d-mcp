#!/bin/zsh
# usage: run.sh <probe.js>   — runs a probe in the front doc via the loader macro, prints out.json
SP=/tmp/c3d-scratch
P=$SP/probe
cat ~/Documents/c3dmcpserver/scripts/probes/prelude.js "$1" > $P/current.js; rm -f $P/out.json $P/done
PREV=$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true')
osascript -e 'tell application "System Events" to set frontmost of process "Cheetah3D" to true'; sleep 0.6
$SP/axpress Tools Script "Macro Script" C3D-MCP-Probes "P00 Hello.js" >/dev/null
for i in {1..300}; do [ -f $P/done ] && break; sleep 0.1; done
osascript -e "tell application \"$PREV\" to activate" >/dev/null 2>&1
cat $P/out.json 2>/dev/null || echo '{"ok":false,"error":"no output (timeout/modal?)"}'
