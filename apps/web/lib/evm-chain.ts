// diana's EVM lane as the QoreChain EVM kit defines it. The kit's published types predate a viem change to one
// optional hook it never sets, so that one field is dropped before handing the chain to our viem.
import { qorechainTestnet } from "@qorechain/evm";
import { defineChain } from "viem";

const { prepareTransactionRequest: _unused, ...chain } = qorechainTestnet;
export const diana = defineChain(chain);
