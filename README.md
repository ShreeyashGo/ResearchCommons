# Research Commons

Shared memory and intelligence platform for scientific research: collaborative PDF reading and annotation, AI citation intelligence, and structured group reviews.

Hackathon MVP in progress. See `docs/PLAN.md` (added in the Phase 1 PR).

## Local setup

Prerequisites: Docker, Node.js 20, pnpm 9, and the Supabase CLI.

```sh
pnpm i
pnpm db:start
pnpm env:local
pnpm dev
```

`AI_PROVIDER=mock` is the default, so no AI provider key is needed for local
development. Stop the local Supabase stack with `pnpm db:stop`.
