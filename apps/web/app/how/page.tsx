// How it works, in plain words.
export const metadata = { title: "How it works" };

const STEPS: [string, string][] = [
  ["Keys", "Every account registers an ML-DSA-87 signing key with proof of possession and an ML-KEM-1024 encryption key. A signed recipient card ties the two together, and nobody seals to a card that doesn't match the chain."],
  ["Sealing", "The data owner's browser splits the data into shards and seals each one to exactly three recipients: the node that trains it and the two verifiers. The coordinator stores only ciphertext and serves it only to those recipients."],
  ["Training", "Each node opens its shard, trains on a CPU kernel that gives the same bits on every machine, and commits to a hash of its checkpoints before revealing them, so nobody can copy another node's answer."],
  ["Verification", "Both verifiers replay every node from the same start. A different hash is a cheat, with no tolerance to argue about. They merge the honest updates, check the result on a validation split, and both sign the settlement with ML-DSA-87."],
  ["Settlement", "The contract checks both signatures with QoreChain's pqcVerify precompile against the verifiers' registered keys, slashes cheaters' stakes, and pays honest nodes in fUSD. Every EVM transaction runs inside a scoped authorisation window."],
  ["The result", "The final model is sealed to the owner alone, who opens it in the browser and checks it on rows that never left their machine."],
  ["Competitions", "Entrants seal their scripts to the verifiers, who run each one in a network-less, pinned sandbox. Hidden labels never enter the sandbox; scores are signed by both verifiers, and the labels are revealed on-chain so anyone can recheck."],
];

export default function How() {
  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">How it works</h1>
      <ol className="space-y-6">
        {STEPS.map(([t, d], i) => (
          <li key={t} className="grid grid-cols-[2rem_1fr] gap-3">
            <span className="text-sm text-seal tabular-nums">0{i + 1}</span>
            <div><h2 className="font-semibold">{t}</h2><p className="mt-1 text-sm text-muted">{d}</p></div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-subtle">Honest limits: a node and the verifiers can read the shards they work on, so the verifiers must be trusted not to leak data; in this demo both verifiers run on one server.</p>
    </div>
  );
}
