# SnowLens

Fast, table-first Snowflake exploration for people who do not write SQL.
Open a table directly, group rows, aggregate values, filter, drill and save.
Datasets are optional business presets, never a prerequisite.

## Local development

Node.js 22 or newer and npm are required.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. Default mode is a deterministic chemical manufacturer
demo with orders, inventory, production, quality and experiments. No credentials
are needed. Mock saved metadata persists in `.snowlens-mock.json` (gitignored).

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

See [architecture](docs/architecture.md), [development](docs/development.md)
and [Snowflake deployment](docs/deployment.md). Licensed under MIT.
