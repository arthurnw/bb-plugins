Shows the permission-gate mode of a Pi thread above its composer and lets you switch it.

## What you get

- A chip in the context row above the composer of any Pi thread running the
  permission-gate extension: Protected, Permissive, or YOLO.
- Click the chip to pick another mode. The plugin sends `/protected`,
  `/permissive`, or `/yolo` to the thread, and Pi replies with the new mode.

## How it works

Pi's bb-bridge extension runs `bb permission-gate report <mode>` when a session
starts and whenever the mode changes. The plugin stores the mode as thread
metadata and pushes it to open windows. Threads that never report a mode show
no chip.
