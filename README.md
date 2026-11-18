# strongChar

**Your data, sealed to only the machines that need it. Every step proven.**

Train models on private data using other people's computers, and run Kaggle-style competitions where the hidden test set never leaks.

- Every byte of data is sealed with post-quantum encryption (ML-KEM-1024, QoreSeal) to only the node and verifiers that work on it. The server in the middle only ever stores ciphertext.
- Two verifiers replay every step exactly; their verdicts are post-quantum signed (ML-DSA-87) and checked on-chain with QoreChain's `pqcVerify` precompile.
- Money moves only inside scoped EVM windows.

Built for **Build Before Q-Day: The QoreChain Developer Fest** (category: Encrypted Apps), on testnet `qorechain-diana`.

Status: in development. The plan lives in [`docs/plan/`](docs/plan/).

## License

MIT, see [LICENSE](LICENSE).
