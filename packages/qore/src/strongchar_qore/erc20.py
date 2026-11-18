"""Move fUSD between its two forms on diana: the bank coin the native AMM pays out and the ERC-20 contracts hold.

The SDK has no composer for cosmos/evm's MsgConvertCoin, so its three-field protobuf is encoded here by hand.
"""

from __future__ import annotations

CONVERT_COIN_TYPE_URL = "/cosmos.evm.erc20.v1.MsgConvertCoin"


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b, n = n & 0x7F, n >> 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _field(num: int, payload: bytes) -> bytes:
    return _varint(num << 3 | 2) + _varint(len(payload)) + payload


def convert_coin_msg(*, denom: str, amount: int, receiver_evm: str, sender_qor: str) -> dict:
    """MsgConvertCoin{coin = {denom, amount}, receiver = 0x address, sender = qor1 address}."""
    coin = _field(1, denom.encode()) + _field(2, str(amount).encode())
    value = _field(1, coin) + _field(2, receiver_evm.encode()) + _field(3, sender_qor.encode())
    return {"type_url": CONVERT_COIN_TYPE_URL, "value": value}
