"""Build public/data/run.json for the film from one live job on the AWS stack: the owner's terminal output and the
server container logs saved in public/raw/. Pure parsing; it makes no chain or network calls.

Usage: python3 video/scripts/build_run.py
Inputs: video/public/raw/{owner,coordinator,node-1..4,verifier-a,verifier-b}.log, job_start.txt
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "public/raw"
NODES = ["node-1", "node-2", "node-3", "node-4"]
CHEATER = "node-4"
# Node addresses as registered on diana (public; they appear in every settlement).
ADDR = {
    "0x9bda1f22a33ccf51ce5a131eecd064257d6539c6": "node-4",
    "0x2b3dbceb6675a8e376550793372f4d088b29039f": "node-3",
    "0x65087efa6840f69779a68da8a8cc58fb9d16e587": "node-2",
    "0x47dea64c3f41de19e9d423da5745d2edccd5f703": "node-1",
}
DEMO_PAYLOAD = "0x3efbb2033f66d1999ee1a8eeffda0967694476a62ef4474d610f442468faf38a"  # vectors/kernel/demo_round.json


def name(addr: str) -> str:
    return ADDR.get(addr.lower(), addr[:10])


def main() -> None:
    start = datetime.fromisoformat((RAW / "job_start.txt").read_text().strip().replace("Z", "+00:00"))
    t0 = start.timestamp()

    def server_log(who: str) -> list[dict]:
        out = []
        for line in (RAW / f"{who}.log").read_text().splitlines():
            m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6})\d*Z\s+\S+ \S+ (.*)", line)
            if not m:
                continue
            ts = datetime.fromisoformat(m.group(1)).replace(tzinfo=timezone.utc).timestamp()
            text = re.sub(r"^strongchar\.keeper ", "", m.group(2))
            text = re.sub(r"0x[0-9a-f]{40}", lambda mm: name(mm.group(0)), text)
            text = re.sub(r"\((0x[0-9a-f]{8})[0-9a-f]{48}([0-9a-f]{8})\)", r"(\1…\2)", text)
            out.append({"t": round(ts - t0, 2), "text": text})
        return out

    logs = {n: server_log(n) for n in [*NODES, "verifier-a", "verifier-b"]}
    coordinator = server_log("coordinator")

    owner_text = (RAW / "owner.log").read_text()
    owner = []
    for line in owner_text.splitlines():
        ts, _, text = line.partition("\t")
        t = datetime.fromisoformat(f"{start:%Y-%m-%d}T{ts}+00:00").timestamp() - t0
        owner.append({"t": round(t, 2), "text": re.sub(r"(0x[0-9a-f]{10})[0-9a-f]{50,}", r"\1…", text)})

    raw = {n: (RAW / f"{n}.log").read_text() for n in [*NODES, "verifier-a", "verifier-b", "coordinator"]}
    rounds = []
    for rid in (1, 2):
        def at(who: str, pat: str) -> float | None:
            hit = next((l for l in logs[who] if re.search(pat, l["text"])), None)
            return hit["t"] if hit else None

        opened = next(l["t"] for l in coordinator if f"opened round {rid}" in l["text"])
        seated = [name(a) for a in re.findall(r"0x[0-9a-f]{40}", next(l for l in raw["coordinator"].splitlines() if f"opened round {rid}" in l))]
        committed, revealed, shards, claimed = {}, {}, {}, {}
        for n in NODES:
            m = re.search(rf"job 4 round {rid} trained shard (\d) and committed \((0x[0-9a-f]+)\)", raw[n])
            shards[n], claimed[n] = int(m.group(1)), m.group(2)
            committed[n] = at(n, rf"round {rid} trained")
            revealed[n] = at(n, rf"round {rid} revealed")
        verdicts = {name(a): v for a, v in re.findall(rf"round {rid} node (0x[0-9a-f]{{40}}): (\w+)", raw["verifier-a"])}
        tx = re.search(rf"round {rid} finalized on-chain \((0x[0-9a-f]{{64}})\)", raw["verifier-a"]).group(1)
        rounds.append({
            "round": rid, "opened": opened, "committed": committed, "revealed": revealed,
            "settled": at("verifier-a", rf"round {rid} finalized"), "seated": seated, "shards": shards, "tx": tx,
            "slashed": [n for n, v in verdicts.items() if v != "Ok"],
            "hashes": {n: {"claimed": claimed[n], "ok": verdicts[n] == "Ok"} for n in seated},
        })

    pays = {n: float(v) for n, v in re.findall(r"(node-\d): claimable ([\d.]+) fUSD", owner_text)}
    stake = {n: int(v) for n, v in re.findall(r"(node-\d): claimable [\d.]+ fUSD, stake (\d+) BERU", owner_text)}
    hold = re.search(r"holdout accuracy: initial ([\d.]+) -> final ([\d.]+)", owner_text)
    created = re.search(r"job 4 created: ([\d.]+) fUSD, (\d+) BERU stake per seat: (0x[0-9a-f]{64})", owner_text)
    pool = re.search(r"community pool: ([\d.]+) fUSD", owner_text)
    slashes = sum(CHEATER in r["slashed"] for r in rounds)
    machines = [{"name": "owner", "role": "owner", "ip": "local", "place": "owner's laptop"},
                {"name": "coordinator", "role": "coordinator", "ip": "32.237.26.58", "place": "AWS Sydney · edge"}]
    machines += [{"name": v, "role": "verifier", "ip": "16.176.220.17", "place": "AWS Sydney · verifiers"} for v in ("verifier-a", "verifier-b")]
    machines += [{"name": n, "role": "node", "ip": "3.107.206.175", "place": "AWS Sydney · nodes", "cheat": n == CHEATER} for n in NODES]

    run = {
        "job": 4, "start": start.isoformat(), "machines": machines, "owner": owner, "coordinator": coordinator, "logs": logs,
        "rounds": rounds, "createTx": created.group(3), "budget": float(created.group(1)), "stake": int(created.group(2)),
        "payouts": pays, "pool": float(pool.group(1)),
        "holdout": {"before": float(hold.group(1)), "after": float(hold.group(2))},
        "cheater": {"name": CHEATER, "stakeBefore": stake[CHEATER] + 60 * slashes, "stakeAfter": stake[CHEATER]},
        "x86Hash": DEMO_PAYLOAD, "armHash": DEMO_PAYLOAD,
    }
    (ROOT / "public/data/run.json").write_text(json.dumps(run, indent=1) + "\n")
    for r in rounds:
        print(f"round {r['round']}: seated {r['seated']} slashed {r['slashed']} tx {r['tx'][:12]}…  opened t+{r['opened']:.0f}s settled t+{r['settled']:.0f}s")
    print("payouts", pays, "pool", run["pool"], "holdout", run["holdout"], "cheater", run["cheater"])


if __name__ == "__main__":
    main()
