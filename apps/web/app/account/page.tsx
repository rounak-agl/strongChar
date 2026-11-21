// Your account: keys made and kept in this browser, set up on chain, and sealing that happens here.
import { KeyRound } from "lucide-react";
import { Page } from "@/components/page";
import { OwnerPanel } from "@/components/account/owner-panel";

export const metadata = { title: "Your account" };

export default function Account() {
  return (
    <Page crumbs={[{ label: "your account" }]} icon={KeyRound} title="Your account"
          meta={<>Your keys are created and kept in this browser, encrypted with your passphrase. Sealing and opening happen here; the coordinator only ever receives ciphertext.</>}>
      <OwnerPanel />
    </Page>
  );
}
