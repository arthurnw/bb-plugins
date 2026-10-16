# Project Picker

Keyboard shortcuts for the project selector in bb's New thread composer.

| Command | Default | What it does |
| --- | --- | --- |
| Project Picker: switch project | `Mod+Shift+J` | Opens a searchable project list. Type to filter, arrows or Ctrl+N/P (Ctrl+J/K) to move, Enter to pick, Esc to close. |
| Project Picker: next project | `Alt+J` | Selects the next project. |
| Project Picker: previous project | `Alt+Shift+J` | Selects the previous project. |

Rebind in Settings → Keyboard or with
`bb settings keyboard set plugin:project-picker/<open|next|previous> <shortcut>`.

Projects follow bb's project order; "No project" (the personal project) is last.

## Limits

- Works in composers bb hosts as a New thread composer: the root New thread
  page and anything that navigates there (for example Canvas).
- Does not reach composers embedded with `experimental_NewThreadComposer`
  (quick-compose, quick-chat). The SDK gives plugins no handle to those.
- Uses experimental SDK APIs (`experimental_registerCommand`,
  `experimental_popups`), so bb updates may require changes.

## Develop

```sh
npm install
npm test && npx tsc
bb plugin build
bb plugin install --yes path:$PWD
```
