"""Log windows must tile [lo, hi] exactly, newest first, each within the RPC's span (checked exhaustively, small)."""

from strongchar_qore.market import LOG_SPAN, windows


def test_windows_tile_the_range() -> None:
    for span in range(1, 7):
        for lo in range(0, 4):
            for hi in range(lo - 3, lo + 25):
                ws = list(windows(lo, hi, span))
                covered = [b for a, c in ws for b in range(c, a - 1, -1)]
                assert covered == list(range(hi, lo - 1, -1))  # every block once, newest first
                assert all(0 < c - a + 1 <= span for a, c in ws)


def test_default_span_matches_the_rpc_cap() -> None:
    assert list(windows(100, 100 + 2 * LOG_SPAN)) == [(100 + LOG_SPAN + 1, 100 + 2 * LOG_SPAN), (101, 100 + LOG_SPAN), (100, 100)]
