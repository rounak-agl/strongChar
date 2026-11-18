# strongChar: design

Status: v2, 18 Nov 2026. Visual style is decided in Phase 4 (MEMORY D18). Sections 1 and 3–7 (principles, components, pages, copy, accessibility) apply whatever the final style.

## 1. Principles

1. **Show the seal.** Every piece of data appears as a sealed object with its recipients, and plaintext only appears on the screen of someone allowed to read it. A judge should *see* that the coordinator holds ciphertext, and see exactly which machines a piece of data is sealed to.
2. **Show the proof.** Every verdict, settlement and score carries a visible "PQ-verified" stamp linking to the transaction where `pqcVerify` ran.
3. **One action per screen.** Each step says who acts next and what one button does.
4. **Plain words.** "Sealed to 3 people", not "ML-KEM-1024 multi-recipient envelope". Technical detail sits one click away in an expandable "under the hood" panel.
5. **Live data or nothing.** No mock numbers on any page that a judge can reach; empty states explain how to make data appear.

## 2. Visual style (deferred)

- Base: a standard component system, grid and restrained motion, with strongChar's own name, mark and copy.
- Decided in Phase 4: palette, type, mark, cover image.
- Fixed now: colors are CSS tokens on `:root` with a dark-mode set; hashes, addresses and ciphertext use a monospace font; status always pairs color with an icon and a word.

## 3. Signature components

| Component | What it shows |
|---|---|
| `SealChip` | Sealed object: kind (shard, weights, script, test set), size, ciphertext prefix `qoreseal:…`, recipients as avatars, the commitment hash beside it. Click → "Under the hood": envelope header, AAD, recipient KEM key IDs. If the viewer is a recipient, an **Open locally** button decrypts in the browser. |
| `ProofStamp` | "PQ-verified" with the signer, algorithm (ML-DSA-87), `pqcVerify ✓`, gas used and explorer link. Red variant for a rejected signature. |
| `WindowMeter` | Open EVM window: allowed targets, value used / cap, txs used / cap, blocks left. Close button. |
| `RoundTimeline` | Open → Train → Commit → Reveal → Replay → Merge → Settle, with per-node state chips and the cheater turning red at Replay. |
| `KeyCard` | An account's three keys (classical, ML-DSA, ML-KEM), registered or not, possession proven or not, with a fix button. |
| `SandboxReport` | A competition entry's two verifier runs side by side: exit code, runtime, peak memory, prediction hash, verdict and rejection reason. |
| `Leaderboard` | Final ranking only after scores are verified; before that, a list of entries with Valid / Invalid / Pending. |

## 4. Pages and flows

| Route | Purpose | Key components |
|---|---|---|
| `/` | Landing: problem, 3-step "seal → train → prove", live counters from chain, two CTAs (Post a job, Host a competition) | hero lattice, stats |
| `/start` | Connect QoreX → SIWQ → register ML-DSA (PoP) → register ML-KEM → open first window. Resumable checklist | `KeyCard`, `WindowMeter` |
| `/jobs`, `/jobs/new`, `/jobs/[id]`, `/jobs/[id]/rounds/[r]` | Post, fund, watch, decrypt result | `SealChip`, `RoundTimeline`, `ProofStamp` |
| `/nodes`, `/nodes/[op]` | Operators, stake, history, slashes | `KeyCard` |
| `/compete`, `/compete/new`, `/compete/[id]`, `/compete/[id]/submit` | Host, submit, validity, final ranking, label reveal | `SealChip`, `SandboxReport`, `Leaderboard`, `ProofStamp` |
| `/sealed` | "What the server sees": live list of everything the coordinator stores, all ciphertext, next to on-chain commitments | `SealChip` |
| `/u/[address]` | Public profile and key status | `KeyCard` |
| `/how` | How it works, in plain words, with diagrams | — |

### 4.1 Post a job (data owner)

1. Pick data: MNIST preset or upload a CSV (preview first 5 rows locally; nothing leaves the browser yet).
2. Pick model and size: hidden units, rounds, nodes, steps per round. Show estimated time and cost.
3. Review recipients: list of nodes and verifiers that will receive each shard, each with a `KeyCard` check.
4. Seal and upload: progress per shard, each becomes a `SealChip`.
5. Fund: open window if needed (`WindowMeter`), approve and create job.
6. Watch: redirect to `/jobs/[id]`.
7. Finish: "Your model is sealed to you" → Open locally → accuracy on your held-out rows.

### 4.2 Enter a competition (entrant)

1. Read task, metric, data schema, sandbox rules (image digest, limits, allowed libraries).
2. Download the public training set and a template script.
3. Upload script → sealed to the two verifiers → submit on-chain.
4. Watch validity: two `SandboxReport` panels fill in. Invalid shows the reason and how to fix it.
5. After the deadline: final `Leaderboard` with `ProofStamp` on the score table, and a label-reveal check mark.

## 5. Copy rules

- Sentence case everywhere. Buttons are verbs: "Seal and upload", "Open locally", "Close window".
- Never say "military-grade", "unhackable", "quantum-proof" or "no one can read". Say "post-quantum encrypted (ML-KEM-1024)" and "post-quantum signed (ML-DSA-87)".
- Empty states say what to do: "No jobs yet. Post one to see rounds here."
- Errors say what happened and the next step, never a raw stack trace.

## 6. Accessibility

WCAG 2.2 AA contrast for all text and both themes; full keyboard path through every flow; status never shown by color alone (icons and words with every red/green); hashes copyable with an accessible label.

## 7. Side entry: Q-Day exposure checker

Single page, same tokens. Input box for an address → three result rows (PQ key, EVM window, KEM key), each Safe / At risk / Unknown with a one-line reason and a fix button that sends the hybrid-signed transaction through QoreX.

## 8. Assets for submission

- Cover image 1600×900 (16:9): the lattice seal mark, the name, "Your data, sealed to only the machines that need it. Every step proven." 
- Video: see PHASES.md, Phase 6.
- Favicon and OG image from the mark.
