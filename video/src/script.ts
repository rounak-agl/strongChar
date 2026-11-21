// The narration, one entry per scene. scripts/voice.mjs turns each line into public/vo/<id>.mp3 and the composition
// sizes every scene to its voiceover plus `pad` seconds, so editing a line re-times the whole film.
export type Scene = { id: string; title: string; line: string; pad: number; min?: number };

export const SCENES: Scene[] = [
  {
    id: "s00-hook",
    title: "Hook: the catch",
    line: "This machine just tried to get paid for training it never did. Two verifiers caught it, and it paid with its stake.",
    pad: 0.4,
  },
  {
    id: "s01-open",
    title: "Cold open",
    line: "Here is why that matters. Every hospital, bank and school is sitting on data that could train a useful model. None of them can hand it to a stranger's computer.",
    pad: 0.6,
  },
  {
    id: "s02-title",
    title: "Title",
    line: "strongChar makes that safe. Train on data nobody can read, and pay only for proven work.",
    pad: 1.0,
  },
  {
    id: "s03-owner",
    title: "The owner posts a job",
    line: "A data owner posts a job from their own machine. The data is split into shards, and each one is sealed with ML-KEM-1024, a post-quantum key, to two independent verifiers. The server in the middle only ever holds ciphertext.",
    pad: 0.8,
  },
  {
    id: "s04-network",
    title: "The network",
    line: "Laptops across the network register their keys and stake. Every round, the coordinator seats the fastest machines online, and a verifier re-seals each seated node's shard to that node alone.",
    pad: 0.8,
  },
  {
    id: "s05-training",
    title: "Training",
    line: "Each node trains on its shard, on a kernel that produces the exact same bytes on any CPU, then commits to a hash of its work before anyone can copy it. But node four isn't training. It is claiming results it never computed.",
    pad: 0.8,
  },
  {
    id: "s06-replay",
    title: "The replay catches the cheater",
    line: "Both verifiers rerun every node, bit for bit. Three hashes match. Node four's doesn't: a replay mismatch, with no tolerance to argue about. Its stake is burned on the spot.",
    pad: 1.0,
  },
  {
    id: "s07-proof",
    title: "Proof on-chain",
    line: "The verifiers sign one settlement with ML-DSA-87, and the contract checks both signatures on-chain with QoreChain's pqcVerify precompile before a single token moves.",
    pad: 0.8,
  },
  {
    id: "s08-pay",
    title: "Payout",
    line: "Honest nodes are paid in fUSD. New nodes start on probation, so throwaway identities earn nothing.",
    pad: 0.8,
  },
  {
    id: "s09-more",
    title: "Competitions and the result",
    line: "The same machinery runs competitions where the hidden labels never leak. And the trained model goes back to its owner alone, sealed, with accuracy on rows it never saw up from thirty-one to seventy-seven percent.",
    pad: 0.8,
  },
  {
    id: "s10-close",
    title: "Close",
    line: "strongChar. Your data, sealed to only the machines that need it. Every step proven.",
    pad: 2.2,
  },
];
