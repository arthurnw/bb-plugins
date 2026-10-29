Switch a Pi thread's permission-gate mode from the composer footer.

## What you get

- A mode picker in the footer of Pi thread composers, next to the context
  donut: Protected, Permissive, or YOLO. It opens a menu on desktop and a
  bottom drawer on phones.
- It only appears in threads whose Pi process has reported a mode.

The picker is inserted into bb's own footer markup, which isn't a plugin API.
A bb update can move or remove it; the picker then stops showing until the
selector in `app.tsx` is updated.

## How it works

Pi's bb-bridge extension runs `bb permission-gate report <mode>` when a session
starts and whenever the mode changes. The plugin stores the mode as thread
metadata and pushes it to open windows. Picks go to Pi through `bb permission-gate wait`, which
Pi's bb-bridge long-polls; no message or model turn is involved.
