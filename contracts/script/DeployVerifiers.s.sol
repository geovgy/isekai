// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {HonkVerifier as UTXO2x2Verifier} from "../src/verifiers/UTXO2x2Verifier.sol";
import {HonkVerifier as RagequitVerifier} from "../src/verifiers/RagequitVerifier.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

contract DeployVerifiersScript is Script {
    using Strings for *;

    ShieldedPool shieldedPool = ShieldedPool(vm.envAddress("SHIELDED_POOL"));
    IVerifier ragequitVerifier;
    IVerifier utxo2x2Verifier;
    
    function run() public {
        vm.startBroadcast();

        // ragequitVerifier = new RagequitVerifier();
        utxo2x2Verifier = new UTXO2x2Verifier();

        // add utxo verifiers
        console.log("\nDeployed verifiers:");
        // console.log("|-- Ragequit -->", address(ragequitVerifier));
        console.log("|-- UTXO2x2 -->", address(utxo2x2Verifier));

        shieldedPool.addVerifier(utxo2x2Verifier, 2, 2);

        vm.stopBroadcast();
    }
}
