// Competitions: listed once the Competitions contract is deployed.
import { deployment } from "@/lib/deployment";
import { Empty } from "@/components/ui";

export const metadata = { title: "Competitions" };

export default function Compete() {
  const deployed = "competitions" in deployment && Boolean((deployment as Record<string, unknown>).competitions);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Competitions</h1>
      {!deployed ? <Empty>The competitions contract isn&apos;t deployed on diana yet.</Empty> : <Empty>No competitions yet.</Empty>}
    </div>
  );
}
