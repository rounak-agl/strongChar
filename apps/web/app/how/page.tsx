// How it works, in plain words, in the order things happen.
import { BookOpen } from "lucide-react";
import { Page } from "@/components/page";
import { Card } from "@/components/primitives";

export const metadata = { title: "How it works" };

const STEPS: [string, string][] = [
  ["Keys", "Every account registers an ML-DSA-87 signing key with proof of possession and an ML-KEM-1024 encryption key. A signed recipient card ties the two together, and nobody seals to a card that doesn't match the chain."],
  ["Sealing", "The data owner splits the data into shards and seals every shard, and the validation split, to the two verifiers only. The coordinator stores ciphertext and serves it only to a listed recipient."],
  ["Seating", "Each round, the coordinator seats the fastest nodes from everyone online, then whoever has waited longest. A verifier then re-seals each seated node's shard to that node alone; the node checks it against the hash the owner committed to."],
  ["Training", "Each node trains on a CPU kernel that gives the same bits on every machine, then commits to a hash of its checkpoints before revealing them, so nobody can copy another node's answer."],
  ["Verification", "Both verifiers replay every node from the same start. A different hash is a cheat, with no tolerance to argue about. They merge the honest updates, check the result on the validation split, and both sign one settlement with ML-DSA-87."],
  ["Settlement", "The contract checks both signatures with QoreChain's pqcVerify precompile, burns a cheater's stake and pays honest nodes in fUSD. New nodes are on probation: their share goes to a community pool that tops up proven nodes, so throwaway nodes earn nothing."],
  ["The result", "After the last round the merged model is sealed to the owner alone, who opens it and scores it on rows that never left their machine."],
  ["Competitions", "Entrants seal their scripts to the verifiers, who run each one in a network-less sandbox under gVisor. Hidden labels never enter the sandbox; scores are signed by both verifiers, and the labels are revealed on-chain so anyone can recheck the ranking."],
];

export default function How() {
  return (
    <Page crumbs={[{ label: "how it works" }]} icon={BookOpen} title="How it works"
          meta={<>Private data, other people&apos;s computers, and nothing taken on trust that the chain can check.</>}>
      <Card className="max-w-flow p-6">
        <ol className="flex flex-col gap-6">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="grid grid-step gap-3">
              <span className="font-mono text-sm tabular text-mosaic">{String(i + 1).padStart(2, "0")}</span>
              <div><h2 className="text-lg font-medium text-ink">{t}</h2><p className="mt-1 max-w-2xl text-sm text-muted">{d}</p></div>
            </li>
          ))}
        </ol>
      </Card>
      <p className="max-w-flow text-xs text-subtle">Where it stops: the two verifiers together can read every sealed input, and a node reads the shard it trains. Everything runs on the qorechain-diana testnet.</p>
    </Page>
  );
}
