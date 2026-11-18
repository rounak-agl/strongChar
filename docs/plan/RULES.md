# strongChar: working rules

These rules apply to every human and coding agent working in this repo. CLAUDE.md at the root points here.

## 1. Licences and credit

- Code is MIT. `LICENSE` keeps every copyright line it carries; never remove one.
- Credit every open-source library, QoreChain kit and template in the README, as the event rules require.
- Run `scripts/leak_check.sh` before every commit. It blocks private names and secrets listed in a gitignored file; a hit fails the commit.
- Build in public: commit small and often, every working day, so the history shows the work across the event.

## 2. Naming

| Thing | Name |
|---|---|
| Product | strongChar |
| Python distributions | `strongchar-core`, `strongchar-workloads`, `strongchar-datasets`, `strongchar-qore`, `strongchar-compete`, `strongchar-node`, `strongchar-verifier`, `strongchar-coordinator` |
| Python modules | `strongchar_core`, … |
| CLIs | `strongchar-node`, `strongchar-verifier` |
| Env prefix | `STRONGCHAR_` |
| Web package | `@strongchar/web`, `@strongchar/abi` |
| Signing domain | `strongChar` (version 1) |
| Token | Beru (BERU, 6 decimals); contracts `BeruToken`, `BeruFaucet` |
| Side-entry repo | `strongChar-qday` |

## 3. Chain and keys

- Testnet `qorechain-diana` only. Never deploy to mainnet `qorechain-vladi`.
- Never commit `.env`, mnemonics, private keys or API tokens. Agents never read `.env` files.
- Never spend from a funded key or deploy unless Rounak asked for that exact action.
- Declare on the platform only the kits and features the code really uses and the listed addresses really exercised.

## 4. Code

- Each file starts with one line saying what it does. Comments explain why, never what.
- Keep changes small and focused. Prefer deleting out-of-scope code over keeping it "just in case".
- Determinism is sacred: no change to the kernel, encodings, merge, judge, finalize or metrics without the vectors still matching and a test proving it.
- The coordinator never decrypts. Any code path that would give it plaintext is a bug.
- Seal only to recipients whose KEM key is bound to a possession-proven ML-DSA key.
- Every contract function that accepts a verifier result checks `pqcVerify` and `possessionProven`.
- Solidity: OpenZeppelin where it fits, custom errors, checks-effects-interactions, `nonReentrant` on value transfer, no admin backdoors beyond what PRD lists.
- Python: type hints, `uv` only, Python 3.12.
- Web: TypeScript strict, server components by default, no mock data on judge-reachable pages.

## 5. Tests and done

- A task is done when its tests pass locally and in CI, the relevant phase checklist item is ticked in PHASES.md, and MEMORY.md has a log line.
- Never claim something works without having run it. If it wasn't tested, say so.
- Live-network tests are marked `live` and skipped in CI.

## 6. Git

- Branch per task, small PRs (aim under 1,000 changed lines), squash merge to `main`.
- Commit messages are plain sentences ("Seal shards to their node and both verifiers"), no type prefixes.
- Commit history is part of the submission: commit early and often so the build is visible across the event window.

## 7. Planning docs

- `docs/plan/` is committed and public. Keep it accurate; it's evidence for the AI-native award.
- MEMORY.md is the single log: decisions, spike results, open questions, daily progress. Update it at the end of every working session.
- If a rule here conflicts with a plan doc, this file wins. If a rule blocks progress, ask Rounak; don't work around it.

## 8. AI use

- Coding agents are welcome. Rounak directs, reviews and merges every change.
- Record notable agent-generated work and the human decisions in AI_USAGE.md as you go, not at the end.
