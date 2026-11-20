// Get started: the three ways in, each with the exact commands.
import { Rocket } from "lucide-react";
import { Page } from "@/components/page";
import { Card, CodePanel, SectionTitle } from "@/components/primitives";

export const metadata = { title: "Get started" };

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8700";

export default function Start() {
  return (
    <Page crumbs={[{ label: "get started" }]} icon={Rocket} title="Get started"
          meta={<>Everything runs from the command line on qorechain-diana testnet. Clone the repo and install with <code className="font-mono text-ink">uv sync --all-packages</code>.</>}>
      <div className="flex max-w-flow flex-col gap-4">
        <Card className="flex flex-col gap-4 p-5" >
          <span id="train" />
          <SectionTitle title="Train on your data" sub="the last CSV column is the target; only ciphertext leaves your machine" />
          <CodePanel code={`export STRONGCHAR_COORDINATOR=${API}\nuv run strongchar-job quote data.csv --rounds 3 --shards 4\nuv run strongchar-job post  data.csv --rounds 3 --shards 4`} />
          <p className="text-sm text-muted">The price follows the compute: fUSD per Gop of training, for every seat and round. When the job finishes, the final model is opened on your machine and scored on holdout rows that never left it.</p>
        </Card>
        <Card className="flex flex-col gap-4 p-5">
          <span id="node" />
          <SectionTitle title="Lend your laptop" sub="earn fUSD for every round you train and both verifiers replay" />
          <CodePanel code={`export STRONGCHAR_COORDINATOR=${API}\nuv run strongchar-node init    # then send it ~2 testnet QOR\nuv run strongchar-node setup   # keys, BERU, stake, join\nuv run strongchar-node doctor\nuv run strongchar-node run`} />
          <p className="text-sm text-muted">New nodes start on probation: their pay goes to the community pool until they have verified work. <code className="font-mono">status</code>, <code className="font-mono">logs</code>, <code className="font-mono">claim</code> and <code className="font-mono">stop</code> manage it.</p>
        </Card>
        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle title="Check the kernel on your machine" sub="one round with a cheater, replayed and settled in about a second" />
          <CodePanel code="uv run python -m strongchar_runtime.demo" />
          <p className="text-sm text-muted">Every hash it prints must match the pinned vector. The same round gives the same bytes on x86 laptops and the arm64 servers this network runs on.</p>
        </Card>
      </div>
    </Page>
  );
}
