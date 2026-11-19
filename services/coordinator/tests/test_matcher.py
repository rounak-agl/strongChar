"""The matcher seats the best available nodes from the whole fleet, never a fixed list."""

from strongchar_coordinator.keeper import BENCH_AFTER, SELFTEST, Fleet, blocker, pick

NOW = 1_000_000.0
STAKE = 200


def node(i: int) -> str:
    return "0x" + f"{i:040x}"


def fleet(bench: dict[int, float], **over) -> Fleet:
    """Nodes joined, staked, idle and online, with the given benchmark seconds, unless overridden."""
    chain = {node(i): (True, STAKE, 0) for i in bench}
    beats = {node(i): {"benchmark_s": b, "selftest": SELFTEST, "seen": NOW - 5} for i, b in bench.items()}
    return Fleet(chain, beats, **over)


def seat(f: Fleet, shards=4, quorum=3, max_nodes=4, shard_last=None):
    return pick(f, job=1, round_id=1, stake=STAKE, quorum=quorum, max_nodes=max_nodes, n_shards=shards,
                shard_last=shard_last or {}, now=NOW, floor_s=60, selftest=SELFTEST)


def test_fastest_nodes_win_the_seats():
    plan, diag = seat(fleet({1: 9.0, 2: 1.0, 3: 5.0, 4: 2.0, 5: 3.0, 6: 7.0}))
    assert plan.nodes == [node(2), node(4), node(5), node(3)]
    assert diag["eligible"] == 6 and diag["blocked"] == {}


def test_longest_idle_breaks_benchmark_ties():
    f = fleet({1: 1.0, 2: 1.0, 3: 1.0, 4: 1.0}, last_seated={node(1): NOW - 10, node(2): NOW - 500})
    plan, _ = seat(f, max_nodes=2, shards=2, quorum=2)
    # Nodes 3 and 4 have never been seated, so they go before 2 (500 s ago) and 1 (10 s ago).
    assert set(plan.nodes) == {node(3), node(4)}


def test_every_blocking_rule_is_reported():
    f = fleet({i: 1.0 for i in range(1, 9)}, missed={node(7): BENCH_AFTER})
    f.chain[node(1)] = (False, STAKE, 0)
    f.chain[node(2)] = (True, STAKE - 1, 0)
    f.beats[node(3)]["seen"] = NOW - 120
    f.chain[node(4)] = (True, STAKE, 9)
    f.beats[node(5)]["selftest"] = "00" * 32
    f.beats[node(6)]["benchmark_s"] = 61
    plan, diag = seat(f, quorum=3)
    assert plan is None  # only node 8 is left
    assert diag["blocked"] == {
        node(1): "not joined", node(2): "stake below the job's requirement", node(3): "offline",
        node(4): "busy in another round", node(5): "self-test result doesn't match",
        node(6): "slower than the benchmark floor", node(7): "benched after missed commits",
    }


def test_a_node_seated_this_tick_is_busy_for_the_next_job():
    f = fleet({1: 1.0})
    f.taken.add(node(1))
    assert blocker(f, node(1), STAKE, NOW, 60, SELFTEST) == "busy in another round"


def test_shards_rotate_when_fewer_nodes_than_shards():
    f = fleet({1: 1.0, 2: 2.0})
    plan, _ = seat(f, shards=4, quorum=2, max_nodes=4, shard_last={0: 3, 1: 3, 2: 1})
    assert plan.shards == [3, 2]  # never-trained shard 3 first, then shard 2 (round 1), not 0 or 1 (round 3)
    assert len(set(plan.shards)) == len(plan.nodes)


def test_seats_never_exceed_shards_or_max_nodes():
    for shards in range(1, 6):
        for max_nodes in range(1, 6):
            plan, _ = seat(fleet({i: float(i) for i in range(1, 8)}), shards=shards, quorum=1, max_nodes=max_nodes)
            assert len(plan.nodes) == min(shards, max_nodes) == len(set(plan.shards))
            assert all(0 <= s < shards for s in plan.shards)
