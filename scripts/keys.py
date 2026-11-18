"""Create the local key store or print every actor's public addresses (never secrets)."""

from __future__ import annotations

import argparse

from strongchar_qore import keystore


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init", help="generate a mnemonic per actor (refuses to overwrite)")
    sub.add_parser("addresses", help="print qor1 and 0x addresses")
    args = parser.parse_args()

    if args.cmd == "init":
        keystore.create()
        print(f"created {keystore.DEFAULT_PATH} (mode 600). Back it up offline now.")
    for actor in keystore.load_all():
        print(f"{actor.name:12} {actor.qor}  {actor.evm}")


if __name__ == "__main__":
    main()
