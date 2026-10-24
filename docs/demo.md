# Local demo

## Prerequisites

Install Docker, Node.js 20, pnpm 9, and the Supabase CLI.

## Start the demo

From the repository root, run:

```sh
pnpm install && pnpm db:start && pnpm env:local && pnpm db:reset && pnpm seed:demo && pnpm dev
```

`pnpm seed:demo` imports the recorded local PDF fixture, so downloading the
paper is not required. Citation matching may use public metadata APIs when
available; if they are unreachable, the demo still seeds with unresolved
references.

## Sign in and explore

The seeded group is **Koala Lab**. Sign in with either account:

| User | Email | Password | Role |
| --- | --- | --- | --- |
| Alice Koala | `alice@koalalab.dev` | `koala-demo-123` | Group owner |
| Bob Koala | `bob@koalalab.dev` | `koala-demo-123` | Group member |

Open Koala Lab, select **Attention Is All You Need**, and inspect the
highlighted passages, comment thread, citations, and Alice's structured
review. Sign in as Bob in a separate browser session to see his private
annotation; it is not visible to Alice.

`AI_PROVIDER=mock` is the default and requires no AI provider keys.
