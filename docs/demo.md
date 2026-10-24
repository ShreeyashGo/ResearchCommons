# Local demo

## Prerequisites

Install Docker, Node.js 20, pnpm 9, and the Supabase CLI.

## Start the demo

From the repository root, run:

```sh
pnpm install && pnpm db:start && pnpm env:local && pnpm db:reset && pnpm seed:demo && pnpm dev
```

`pnpm seed:demo` imports the recorded local PDF fixtures, so downloading the
papers is not required. Citation matching may use public metadata APIs when
available; if they are unreachable, the demo still seeds with unresolved
references.

## Sign in and explore

The seeded group is **Koala Lab**. Sign in with either account:

| User | Email | Password | Role |
| --- | --- | --- | --- |
| Alice Koala | `alice@koalalab.dev` | `koala-demo-123` | Group owner |
| Bob Koala | `bob@koalalab.dev` | `koala-demo-123` | Group member |

Rerunning the seed resets both demo users' passwords to `koala-demo-123`.
Citation processing is skipped when the paper is ready and has references; use
`pnpm seed:demo -- --reprocess` to force it to run again.

Open Koala Lab, select **Attention Is All You Need**, and inspect the
highlighted passages, comment thread, citations, and Alice's structured
review. Sign in as Bob in a separate browser session to see his private
annotation; it is not visible to Alice.

Then select **Agentic Misalignment: How LLMs Could Be Insider Threats**:

1. Open the definition and blackmail-scenario highlights, then compare the
   replacement/goal-conflict triggers with the real-world limitation.
2. Open the limitation thread to follow Bob's argument that the scenarios are
   contrived and Alice's response.
3. Select a citation and try **Explain**, then use **Summarize** to review the
   paper's main points.

`AI_PROVIDER=mock` is the default and requires no AI provider keys.
