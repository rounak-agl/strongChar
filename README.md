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

## Credits

Built with these open-source projects and QoreChain kits:

- QoreChain Python SDKs: [`qorechain-sdk`](https://pypi.org/project/qorechain-sdk/), [`qorechain-qoreseal`](https://pypi.org/project/qorechain-qoreseal/), [`qorechain-qoresign`](https://pypi.org/project/qorechain-qoresign/), [`qorechain-pqc`](https://pypi.org/project/qorechain-pqc/)
- [web3.py](https://github.com/ethereum/web3.py), [liboqs](https://github.com/open-quantum-safe/liboqs) (via `liboqs-python`)
- [Foundry](https://github.com/foundry-rs/foundry) and [forge-std](https://github.com/foundry-rs/forge-std), [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [uv](https://github.com/astral-sh/uv), [pytest](https://pytest.org), [pnpm](https://pnpm.io)

The list grows as the build does. How AI was used is in [AI_USAGE.md](AI_USAGE.md).

## License

MIT, see [LICENSE](LICENSE).
