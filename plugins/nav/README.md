# bb-plugin-nav

Ctrl+H/J/K/L moves focus between panes in a bb window, like
[vim-tmux-navigator](https://github.com/christoomey/vim-tmux-navigator).

| Key    | Moves focus |
| ------ | ----------- |
| Ctrl+H | left        |
| Ctrl+J | down        |
| Ctrl+K | up          |
| Ctrl+L | right       |

Navigable regions:

- Thread composers (one per split pane)
- Terminals in the right panel
- The sidebar (focuses the active thread row)
- The Browser tab's chrome
- Any other pane, such as file viewers or plugin pages

The neighbor is chosen by on-screen position: the nearest region in that
direction that overlaps the current one, otherwise the nearest region in that
direction.

## Pickers

Ctrl+N / Ctrl+P move down and up in pickers, as in macOS text fields: the
command palette, quick open, the model picker, other bb comboboxes, and the
composer's `/` and `@` menus while one is open. Elsewhere the keys are
unchanged. The plugin replaces the chord with an ArrowDown / ArrowUp on the
same element, so each picker keeps its own behavior.

## Behavior notes

- In a terminal with no pane in that direction, the key goes to the terminal,
  so Ctrl+L still clears the screen at the right edge. Elsewhere the key is
  always consumed, so the composer's Emacs-style Ctrl+H/K bindings are off.
- The command palette, menus, and dialogs keep Ctrl+J/K for their own lists.
- Keys pressed inside a Browser tab's web page never reach bb, so navigation
  out of a page has to start from the address bar.
- There is no Neovim integration: Neovim in a bb terminal only gets these
  keys when no bb pane is in that direction, so it can't move between its own
  splits first.

## Development

```sh
npm install --include=dev
npm test           # geometry unit tests
npm run typecheck
bb plugin install .
bb plugin dev      # rebuild and reload on save
```

`regions.ts` and `pickers.ts` rely on bb's DOM attributes
(`data-split-pane-id`, `data-app-composer`, `data-app-terminal`,
`data-app-browser`, `data-sidebar`, `data-promptbox-typeahead-menu`), which are
not a public API and may change between bb releases.
