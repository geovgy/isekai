// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Kamui} from "../src/Kamui.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {HonkVerifier as UTXO2x2Verifier} from "../src/verifiers/UTXO2x2Verifier.sol";
import {HonkVerifier as RagequitVerifier} from "../src/verifiers/RagequitVerifier.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

contract DeployKamuiScript is Script {
    using Strings for *;

    // address GOVERNOR = address(0x1); // TODO: set governor address
    address GOVERNOR = vm.envAddress("GOVERNOR");

    Kamui kamui;

    IPoseidon2 poseidon2;
    IVerifier ragequitVerifier;

    IVerifier utxo2x2Verifier;

    struct AddUTXOVerifierParams {
        uint256   inputs;
        uint256   outputs;
        IVerifier verifier;
    }
    
    function run() public {
        vm.startBroadcast();

        assert(GOVERNOR != address(0));

        poseidon2 = IPoseidon2(address(new Poseidon2()));
        ragequitVerifier = new RagequitVerifier();
        kamui = new Kamui(poseidon2, ragequitVerifier, msg.sender);

        console.log("\nDeployment Results:");
        console.log("\nKamui -->", address(kamui));
        console.log("|-- Poseidon2 -->", address(poseidon2));
        console.log("|-- Ragequit verifier -->", address(ragequitVerifier));
        console.log("|-- Governor -->", GOVERNOR);

        // add utxo verifiers
        AddUTXOVerifierParams[] memory params = new AddUTXOVerifierParams[](1);
        params[0] = AddUTXOVerifierParams({
            inputs: 2,
            outputs: 2,
            verifier: new UTXO2x2Verifier()
        });

        console.log("\nAdding UTXO verifiers:");
        for (uint256 i; i < params.length; i++) {
            kamui.addVerifier(params[i].verifier, params[i].inputs, params[i].outputs);

            string memory utxoType = string(bytes.concat(bytes(params[i].inputs.toString()), "x", bytes(params[i].outputs.toString()), " -->"));
            console.log("|--", utxoType, address(params[i].verifier));
        }

        // Transfer ownership to governor
        if (GOVERNOR != msg.sender) {
            kamui.transferOwnership(GOVERNOR);
        }

        vm.stopBroadcast();
    }
}
