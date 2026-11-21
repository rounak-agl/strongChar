// Screen recordings for the film: Playwright with an injected cursor, smooth eased scrolling and pauses timed for
// narration. Writes public/clips/<name>.mp4 (webm transcoded with Remotion's ffmpeg) and updates public/data/clips.json.
// Usage: node scripts/record.mjs [job]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const [job = "4"] = process.argv.slice(2);
const SITE = "https://strongchar.vercel.app";

const CURSOR = `
  (() => { if (document.getElementById('__c')) return;
    const c = document.createElement('div'); c.id = '__c';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(242,240,237,.9);box-shadow:0 0 0 4px rgba(232,54,28,.35);pointer-events:none;transform:translate(-50%,-50%);left:-40px;top:-40px;transition:left .45s cubic-bezier(.4,0,.2,1),top .45s cubic-bezier(.4,0,.2,1)';
    document.body.appendChild(c);
    window.__move = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; };
  })();`;

async function smoothScroll(page, to, ms = 2200) {
  await page.evaluate(async ([to, ms]) => {
    // The app scrolls inside its own panel, not the window: use the largest scrollable element.
    const el = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))
      .sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? document.scrollingElement;
    to = Math.min(to, el.scrollHeight - el.clientHeight);
    const from = el.scrollTop, t0 = performance.now();
    await new Promise((done) => { const step = (now) => { const p = Math.min(1, (now - t0) / ms); const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; el.scrollTop = from + (to - from) * e; p < 1 ? requestAnimationFrame(step) : done(); }; requestAnimationFrame(step); });
  }, [to, ms]);
}

async function point(page, selector) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (box) await page.evaluate(([x, y]) => window.__move(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
  await page.waitForTimeout(700);
}

async function record(name, url, script) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: join(ROOT, "public/raw/rec"), size: { width: 1920, height: 1080 } }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.addStyleTag({ content: "html{scroll-behavior:auto}" });
  await page.evaluate(CURSOR);
  await page.waitForTimeout(800);
  await script(page);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video.path();
  const out = join(ROOT, "public/clips", `${name}.mp4`);
  execFileSync("npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", "30", out], { cwd: ROOT });
  rmSync(webm);
  console.log(`${name}: ${out}`);
  return name;
}

const done = [];
done.push(await record("receipt", `${SITE}/jobs/${job}/rounds/1`, async (p) => {
  await p.waitForTimeout(1200);
  await point(p, "text=/REPLAYMISMATCH/i");
  await p.waitForTimeout(1200);
  await smoothScroll(p, 700, 2500);
  await point(p, "text=/pqcVerify/i");
  await p.waitForTimeout(1500);
}));
done.push(await record("compete", `${SITE}/compete/2`, async (p) => {
  await p.waitForTimeout(1500);
  await point(p, "text=/Won/");
  await smoothScroll(p, 650, 2600);
  await point(p, "text=/Crash/");
  await p.waitForTimeout(1200);
  await smoothScroll(p, 1500, 2600);
  await point(p, "text=/match the commitment/");
  await p.waitForTimeout(1600);
}));

const clipsFile = join(ROOT, "public/data/clips.json");
const clips = existsSync(clipsFile) ? JSON.parse(readFileSync(clipsFile, "utf8")) : {};
for (const n of done) clips[n] = true;
writeFileSync(clipsFile, JSON.stringify(clips, null, 2) + "\n");
