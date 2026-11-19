# strongChar

**Your data, sealed to only the machines that need it. Every step proven.**

Train models on private data using other people's computers, and run Kaggle-style competitions where the hidden test set never leaks.

- Every byte of data is sealed with post-quantum encryption (ML-KEM-1024, QoreSeal) to only the node and verifiers that work on it. The server in the middle only ever stores ciphertext.
- Two verifiers replay every step exactly; their verdicts are post-quantum signed (ML-DSA-87) and checked on-chain with QoreChain's `pqcVerify` precompile.
- Money moves only inside scoped EVM windows.

Built for **Build Before Q-Day: The QoreChain Developer Fest** (category: Encrypted Apps), on testnet `qorechain-diana`.

Status: in development. The plan lives in [`docs/plan/`](docs/plan/).

## Deployed on qorechain-diana (EVM chain 9800)

| Contract | Address |
|---|---|
| JobMarket | `0xa5FACae25c46bA115f4A157876dbFb67cF32EaDa` |
| NodeRegistry | `0x081138AA2ec962d7Fe583F3F135683D9C3B273f1` |
| BeruToken (BERU) | `0x6Cd5aa3233E040080ab763a15b7c33ac0bC46D34` |
| BeruFaucet | `0xCF740c7D85C5E708cB8e3a64873aa4dB29Ba3b67` |

Payments use the event's fUSD ERC-20 at `0x97143B771D34ddb9130b807b135Ae675A5a963CA`. Addresses and the deploy block live in [`networks/diana.toml`](networks/diana.toml); ABIs in [`packages/abi`](packages/abi).

Live check after deploy: two real ML-DSA-87 signatures from the registered verifier keys verify through `JobMarket.checkSignature` with the chain's `pqcVerify` precompile (211,870 gas each); a tampered signature is rejected.

## First sealed job on diana (19 Nov 2026)

`scripts/demo_job.py` with the coordinator, four nodes (node-4 set to cheat) and two verifiers running (`scripts/run_local.sh`):

1. The owner standardised a synthetic health table (8,000 rows, no real people), sealed each of 4 shards to its node and both verifiers and the validation split to the verifiers only, and uploaded only ciphertext.
2. The owner swapped QOR for fUSD in native AMM pool 2, converted it to the ERC-20 and funded job 1 with 0.02 fUSD: [`0x23fb2482…`](https://explore.qore.network/tx/0x23fb2482beaa674d065bf9ab617a8c309ed268a3792c06f98c48d6716724db83).
3. Round 1 opened [`0x73ecdd85…`](https://explore.qore.network/tx/0x73ecdd8591b54a5b2010269c33089fc5b8001fa9346dfb46ff7f195fde9830b2); every node trained its shard and committed, then revealed. Both verifiers replayed all four bit for bit: three matched, node-4 was a `ReplayMismatch`. Both ML-DSA-87 signatures verified on-chain and node-4 was slashed: [`0x0656fd3a…`](https://explore.qore.network/tx/0x0656fd3a8073904473df37fafa6d8a9befbb4e905150eaf73d5544eb1b349a16) (653,271 gas).
4. Round 2 started from the merged weights, sealed by the verifiers to the next round's nodes, and settled the same way: [`0xb6a33a54…`](https://explore.qore.network/tx/0xb6a33a54bc6affbf31f9f172aec2edfa5d6eaab2a44cf41742a0f4ac5ba92fc5).
5. The final model was sealed to the owner only and opened locally: holdout accuracy **0.310 → 0.777** on rows that never left the owner. Honest nodes claimed their fUSD; node-4 lost its 200 BERU stake and earned nothing.
6. `python -m strongchar_coordinator.audit` over everything the coordinator stored: no plaintext.

## Security

What is protected, from whom, and where it stops: [THREAT_MODEL.md](THREAT_MODEL.md).

## Credits

Built with these open-source projects and QoreChain kits:

- QoreChain Python SDKs: [`qorechain-sdk`](https://pypi.org/project/qorechain-sdk/), [`qorechain-qoreseal`](https://pypi.org/project/qorechain-qoreseal/), [`qorechain-qoresign`](https://pypi.org/project/qorechain-qoresign/), [`qorechain-pqc`](https://pypi.org/project/qorechain-pqc/)
- [web3.py](https://github.com/ethereum/web3.py), [liboqs](https://github.com/open-quantum-safe/liboqs) (via `liboqs-python`)
- [Foundry](https://github.com/foundry-rs/foundry) and [forge-std](https://github.com/foundry-rs/forge-std), [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [uv](https://github.com/astral-sh/uv), [pytest](https://pytest.org), [pnpm](https://pnpm.io)

The list grows as the build does. How AI was used is in [AI_USAGE.md](AI_USAGE.md).

## License

MIT, see [LICENSE](LICENSE).
