# @arthurnw/bb-shared

Code shared by the Bots, Launcher, and Canvas plugins. TypeScript source only:
no build step, and each plugin bundles what it imports.

| Subpath | Contents |
| --- | --- |
| `/bots` | `Bot` and `BotDraft`, limits, mention and draft helpers, `BOTS_PLUGIN_ID`, `TRUSTED_ORIGIN_PLUGINS` |
| `/bots/schema` | Bots RPC contract and zod schemas (server side) |
| `/events` | Window event names and `openNewThread`, `openHandoff`, `onNewThread`, `onHandoff`, `notifyBotsChanged` |
| `/composer` | `ComposerDialog`, `ModelList`, `ModelTrigger`, `BotAvatar`, `useModelSlot`, focus and font helpers |
| `/projects` | Project ordering, cycling, filtering, and `ProjectList` |
| `/selection` | `ModelSelection`, presets, `modelSpec`, `sameModel` |
| `/selection/schema` | zod schemas for the above (server side) |

Consumers list `"@arthurnw/bb-shared": "file:../../packages/shared"` in
`dependencies` and keep their own lockfiles. Import by package name only; path
installs reject relative imports that leave the plugin directory. After editing
this package, run `bb plugin reload <id>` for each consumer.

```sh
npm install
npm test
npx tsc
```
