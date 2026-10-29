#!/bin/sh
# Dev helper: click OK on every AXDialog of Cheetah3D (only for dialogs a live test itself caused).
for i in 1 2 3 4 5; do
  osascript -e 'tell application "System Events" to tell process "Cheetah3D"
    set n to count of windows
    repeat with i from 1 to n
      try
        if subrole of window i is "AXDialog" then
          click button "OK" of window i
          return "clicked"
        end if
      end try
    end repeat
    return "none"
  end tell' 2>/dev/null | grep -q clicked || break
  sleep 1
done
