"""The committed vectors must match what the code computes today."""

from strongchar_core import vectors


def test_committed_vectors_are_current():
    assert vectors.PATH.read_text() == vectors.dump(vectors.build()), "run: uv run python -m strongchar_core.vectors"
