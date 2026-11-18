# How AI is used to build strongChar

strongChar is built by one person (Rounak) working with an AI coding agent (Claude Code, Anthropic). This file is a running log, updated as the work happens, not written at the end.

## Workflow

1. **Rounak decides.** Every product decision (category, scope, token, hosting, cut order, wording) is asked and answered explicitly; the agent does not assume. Decisions are numbered in [docs/plan/MEMORY.md](docs/plan/MEMORY.md) with the reason for each.
2. **The agent researches and plans.** It reads the event rules, FAQ and chain parameters, checks package registries, and drafts the plan in [docs/plan/](docs/plan/) (PRD, architecture, design, phases, rules, memory).
3. **The agent verifies before it builds.** Unknowns are turned into small spikes that run against the real testnet (free `eth_call` where possible) and their results are written to MEMORY.md before code depends on them.
4. **The agent writes code and tests; Rounak reviews and merges.** Work lands on a branch per task with tests, CI runs, and Rounak approves the merge.
5. **Anything outward-facing waits for Rounak.** Publishing, spending testnet funds or cloud credits, wallet transfers and approvals are done by Rounak or only after Rounak says so.

## What the agent generated

| Date | Work | Human contribution |
|---|---|---|
| 18 Nov | Research on the event, rules and chain; the full plan in docs/plan | Chose category, scope, token name, hosting, design direction; answered every open question |
| 18 Nov | Red-team review of the plan (security, rules, schedule) and the resulting fixes D20–D34 | Chose two-VM hosting, the tagline, the cut order |
| 18 Nov | AWS CLI and agent toolkit setup; hosting cost check | Created the AWS project, signed in, picked the help level |
| 18 Nov | Public repo, project page form, GitHub App selection | Approved publishing, clicked Install on the GitHub App |
| 18 Nov | Phase 0 scaffolding: uv and pnpm workspaces, Foundry, CI, key store with tests, `PQ` precompile library with tests | Review and merge pending |
| 18 Nov | Spike S2: found `pqcVerify`'s exact message format with live `eth_call`s and measured its gas | — |

## Where AI was not trusted blindly

- Chain behaviour (message format for `pqcVerify`, windows, randomness, key status) is measured on the testnet, not assumed from documentation.
- Claims in the README and on the project page are checked against what the code and chain actually do (for example the tagline was corrected because it overstated who can read data).
