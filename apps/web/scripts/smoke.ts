// Smoke run of the web app in a real browser with the QoreX test double injected, as QoreX injects itself.
// Every page loads without a script error; the signature re-check passes on a settled job; a fresh browser account
// is created, sees QoreX, and a refused QoreX transfer is reported. Nothing is signed or spent.
// Run: SMOKE_URL=http://localhost:3100 pnpm --filter @strongchar/web smoke   (default: the local dev server)
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { chromium, type Page } from "playwright";

const BASE = (process.env.SMOKE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const SETTLED_JOB = Number(process.env.SMOKE_JOB ?? 5);
let failed = 0;
const ok = (name: string, cond: boolean, detail = "") => { console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`); if (!cond) failed++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.addInitScript({ content: createQorexMock({ profile: "current", autoApprove: false }).initScript() });
const errors: string[] = [];
const watch = (p: Page) => p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));

try {
  const page = await ctx.newPage();
  watch(page);
  for (const path of ["/", "/jobs", "/nodes", "/sealed", "/how", "/start", "/compete", "/jobs/new", `/jobs/${SETTLED_JOB}`]) {
    const r = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60_000 });
    ok(`${path} loads`, r?.status() === 200, String(r?.status()));
  }

  await page.getByRole("button", { name: /^Check \d+ settlements?$/ }).click();
  await page.getByText("Every settlement checks out").waitFor({ timeout: 60_000 }).then(() => ok("settlement signatures re-checked through pqcVerify", true),
    () => ok("settlement signatures re-checked through pqcVerify", false));

  await page.goto(BASE + "/account", { waitUntil: "networkidle" });
  ok("the page sees QoreX", await page.evaluate(() => !!(window as any).qorex?.native));
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download a backup" }).click();
  await download;
  const pass = "smoke-test-passphrase";
  const fields = page.locator('input[type="password"]');
  await fields.nth(0).fill(pass);
  await fields.nth(1).fill(pass);
  await page.getByRole("button", { name: "Save and unlock" }).click();
  await page.getByText("This browser's account").waitFor({ timeout: 60_000 });
  ok("a new account is created and unlocked in the browser", true);
  await page.getByText("No ML-DSA-87 key on chain yet").waitFor({ timeout: 30_000 }).then(() => ok("the PQC badge reads the chain", true), () => ok("the PQC badge reads the chain", false));

  const fund = page.getByRole("button", { name: "Send 2 QOR from QoreX" });
  ok("funding from QoreX is offered", await fund.isEnabled());
  await fund.click();
  const answer = async (approve: boolean) => {
    await page.waitForFunction(() => (window as any).__qorexMock.pendingApprovals > 0, null, { timeout: 30_000 });
    await page.evaluate((a) => (a ? (window as any).__qorexMock.approveNext() : (window as any).__qorexMock.rejectNext()), approve);
  };
  await answer(true); // connect the site
  await answer(false); // refuse the transfer
  await page.getByText("QoreX: signature rejected").waitFor({ timeout: 30_000 }).then(() => ok("a refused QoreX transfer is reported", true), () => ok("a refused QoreX transfer is reported", false));
  const asked = await page.evaluate(() => (window as any).__qorexMock.requests.map((r: any) => `${r.method}:${r.approval}`));
  ok("QoreX was asked to connect and send, nothing else", JSON.stringify(asked) === JSON.stringify(["native:getKey:approved", "native:signAndBroadcast:rejected"]), asked.join(", "));
} finally {
  await browser.close();
}

ok("no script errors on any page", errors.length === 0, errors.slice(0, 3).join(" | "));
if (failed) { console.error(`${failed} smoke checks failed`); process.exit(1); }
console.log(`smoke run passed against ${BASE}`);
