# strongChar

**Your data, sealed to only the machines that need it. Every step proven.**

Train models on private data using other people's computers, and run Kaggle-style competitions where the hidden test set never leaks.

- Every byte of data is sealed with post-quantum encryption (ML-KEM-1024, QoreSeal) to only the node and verifiers that work on it. The server in the middle only ever stores ciphertext.
- Two verifiers replay every step exactly; their verdicts are post-quantum signed (ML-DSA-87) and checked on-chain with QoreChain's `pqcVerify` precompile.
- Money moves only inside scoped EVM windows.

Built for **Build Before Q-Day: The QoreChain Developer Fest** (category: Encrypted Apps), on testnet `qorechain-diana`.

Status: in development. The plan lives in [`docs/plan/`](docs/plan/).

## Credits

Built with these open-source projects and QoreChain kits:

- QoreChain Python SDKs: [`qorechain-sdk`](https://pypi.org/project/qorechain-sdk/), [`qorechain-qoreseal`](https://pypi.org/project/qorechain-qoreseal/), [`qorechain-qoresign`](https://pypi.org/project/qorechain-qoresign/), [`qorechain-pqc`](https://pypi.org/project/qorechain-pqc/)
- [web3.py](https://github.com/ethereum/web3.py), [liboqs](https://github.com/open-quantum-safe/liboqs) (via `liboqs-python`)
- [Foundry](https://github.com/foundry-rs/foundry) and [forge-std](https://github.com/foundry-rs/forge-std), [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [uv](https://github.com/astral-sh/uv), [pytest](https://pytest.org), [pnpm](https://pnpm.io)

The list grows as the build does. How AI was used is in [AI_USAGE.md](AI_USAGE.md).

## License

MIT, see [LICENSE](LICENSE).
