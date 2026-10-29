Switch a Pi thread's permission-gate mode from the composer's `+` menu.

## What you get

- A **Permissions** row in the `+` menu of Pi thread composers. It opens a
  popup with Protected, Permissive, and YOLO; the current mode is checked.
- The same menu works on phone, web, and desktop. The row is greyed out in
  threads that don't run Pi.

## How it works

Pi's bb-bridge extension runs `bb permission-gate report <mode>` when a session
starts and whenever the mode changes. The plugin stores the mode as thread
metadata and pushes it to open windows. Picks go to Pi through `bb permission-gate wait`, which
Pi's bb-bridge long-polls; no message or model turn is involved.
