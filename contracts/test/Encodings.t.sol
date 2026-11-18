// SPDX-License-Identifier: MIT
// The Solidity encodings must reproduce vectors/encodings.json, which strongchar_core.vectors writes from Python.
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Encodings} from "../src/Encodings.sol";

contract EncodingsTest is Test {
    using stdJson for string;

    string json;

    function setUp() public {
        json = vm.readFile("../vectors/encodings.json");
    }

    function test_domain() public view {
        address market = json.readAddress(".jobMarket");
        assertEq(Encodings.domain(9800, market), json.readBytes32(".domain"));
    }

    function test_commitHash() public view {
        bytes32 dom = json.readBytes32(".domain");
        for (uint256 i; i < 2; i++) {
            string memory k = string.concat(".commitHash[", vm.toString(i), "]");
            bytes32 got = Encodings.commitHash(
                dom,
                json.readUint(string.concat(k, ".jobId")),
                json.readUint(string.concat(k, ".roundId")),
                json.readAddress(string.concat(k, ".node")),
                json.readBytes32(string.concat(k, ".root")),
                json.readBytes32(string.concat(k, ".salt"))
            );
            assertEq(got, json.readBytes32(string.concat(k, ".hash")));
        }
    }

    function _payouts() internal view returns (Encodings.Payout[] memory p) {
        p = new Encodings.Payout[](2);
        for (uint256 i; i < 2; i++) {
            string memory k = string.concat(".settlement.payouts[", vm.toString(i), "]");
            p[i] = Encodings.Payout(json.readAddress(string.concat(k, "[0]")), json.readUint(string.concat(k, "[1]")));
        }
    }

    function test_payoutsHashAndSettlementPayload() public view {
        Encodings.Payout[] memory p = _payouts();
        assertEq(Encodings.payoutsHash(p), json.readBytes32(".payoutsHash[0].hash"));
        assertEq(Encodings.payoutsHash(new Encodings.Payout[](0)), json.readBytes32(".payoutsHash[1].hash"));
        bytes32 payload = Encodings.settlementPayload(
            json.readUint(".settlement.jobId"),
            json.readUint(".settlement.roundId"),
            uint8(json.readUint(".settlement.outcome")),
            json.readBytes32(".settlement.aggregateHash"),
            uint32(json.readUint(".settlement.slashedBitmap")),
            json.readBytes32(".settlement.aggEvidenceHash"),
            json.readBytes32(".settlement.payEvidenceHash"),
            p
        );
        assertEq(payload, json.readBytes32(".settlement.payloadHash"));
    }

    function test_pqMessage() public view {
        assertEq(Encodings.PQ_DOMAIN_TAG, json.readBytes32(".pqMessage.domainTag"));
        bytes memory m = Encodings.pqMessage(
            9800,
            json.readAddress(".jobMarket"),
            uint8(json.readUint(".pqMessage.kind")),
            json.readBytes32(".pqMessage.payloadHash"),
            uint64(json.readUint(".pqMessage.expiryBlock"))
        );
        assertEq(m, json.readBytes(".pqMessage.message"));
    }

    function test_competitionPayloads() public view {
        assertEq(
            Encodings.validityPayload(3, 2, true, json.readBytes32(".competition.validity.predHash")),
            json.readBytes32(".competition.validity.payload")
        );
        uint256[] memory es = new uint256[](2);
        int256[] memory sc = new int256[](2);
        (es[0], es[1], sc[0], sc[1]) = (0, 2, 700000, -120000);
        assertEq(Encodings.scoresPayload(3, es, sc), json.readBytes32(".competition.scores.payload"));
        assertEq(
            Encodings.labelCommit(json.readBytes(".competition.labels.labels"), json.readBytes32(".competition.labels.salt")),
            json.readBytes32(".competition.labels.commit")
        );
    }
}
