// The QoreX funding path against the QoreX test double: no wallet installed, then the mock installed with the
// "current" profile (what QoreX does today). The user refuses the transfer, so nothing is broadcast or spent.
// Run: pnpm --filter @strongchar/web check:qorex
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { qorechainRegistry } from "@qorechain/sdk";
import { fundFromQorex, qorexAddress, qorexReady } from "../lib/browser/qorex";

let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failed++;
};
const TO = createQorexMock({ accountIndex: 1 }).addresses().native; // the browser account stand-in; nothing reaches it

const g = globalThis as any;
g.window = g;
const events = new EventTarget(); // a minimal window: the mock announces itself with EIP-6963 events
for (const k of ["addEventListener", "removeEventListener", "dispatchEvent"] as const) g[k] = events[k].bind(events);
ok("no wallet: the page reports QoreX as unavailable", !qorexReady());

const mock = createQorexMock({ profile: "current", autoApprove: false });
const ctl = mock.install(g);
ok("mock installed: signAndBroadcast is offered", qorexReady());
const waitApproval = async () => { for (let i = 0; i < 150 && ctl.pendingApprovals === 0; i++) await new Promise((r) => setTimeout(r, 20)); return ctl.pendingApprovals; };
const addr = qorexAddress();
ok("connecting the site asks the user first", (await waitApproval()) === 1);
ctl.approveNext();
ok("the page reads the wallet's native address", (await addr) === mock.addresses().native, mock.addresses().native);

ctl.clearRequests();
const pending = fundFromQorex(TO, 2_000_000n).then(() => "sent", (e: Error) => e.message);
ok("the transfer waits for the user's approval", (await waitApproval()) === 1);
ctl.rejectNext();
const outcome = await pending;
ok("a refusal reaches the page as an error", outcome !== "sent", outcome);

const req = ctl.requests.find((r) => r.method === "native:signAndBroadcast");
const body = JSON.stringify(req?.params ?? {});
ok("one signAndBroadcast was asked for", !!req && req.approval === "rejected");
ok("it is a MsgSend on qorechain-diana", body.includes("/cosmos.bank.v1beta1.MsgSend") && body.includes("qorechain-diana"));
const m = (req?.params as any)?.messages?.[0] ?? (req?.params as any)?.[0]?.messages?.[0];
const send = m ? (qorechainRegistry().decode({ typeUrl: m.typeUrl, value: Uint8Array.from(Object.values(m.value) as number[]) }) as any) : null;
ok("from the wallet, to the browser account, 2 QOR", send?.fromAddress === mock.addresses().native && send?.toAddress === TO
  && send?.amount?.[0]?.denom === "uqor" && send?.amount?.[0]?.amount === "2000000", send ? `${send.toAddress} ${send.amount?.[0]?.amount}${send.amount?.[0]?.denom}` : "not decoded");
ok("nothing else was asked of the wallet", ctl.requests.every((r) => ["native:getKey", "native:signAndBroadcast"].includes(r.method)),
  ctl.requests.map((r) => r.method).join(", "));

if (failed) { console.error(`${failed} checks failed`); process.exit(1); }
console.log("QoreX funding path behaves as QoreX does today");
