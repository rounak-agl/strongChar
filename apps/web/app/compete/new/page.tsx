// Host a competition: the test rows and labels are sealed in this browser; only ciphertext and transactions leave it.
import { Trophy } from "lucide-react";
import { Page } from "@/components/page";
import { HostCompetition } from "@/components/compete/host-competition";

export const metadata = { title: "Host a competition" };

export default function NewCompetition() {
  return (
    <Page crumbs={[{ href: "/compete", label: "competitions" }, { label: "host" }]} icon={Trophy} title="Host a competition"
          meta={<>Entrants see your training rows and never your test labels. Their scripts run in the verifiers&apos; sandbox, both verifiers sign the scores with ML-DSA-87, and the contract pays the winner.</>}>
      <HostCompetition />
    </Page>
  );
}
