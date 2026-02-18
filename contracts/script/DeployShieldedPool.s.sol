// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {HonkVerifier as UTXO2x2Verifier} from "../src/verifiers/UTXO2x2Verifier.sol";
import {HonkVerifier as RagequitVerifier} from "../src/verifiers/RagequitVerifier.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {ICrossL2ProverV2} from "../src/interfaces/ICrossL2ProverV2.sol";

contract DeployShieldedPoolScript is Script {
    using Strings for *;

    // address GOVERNOR = address(0x1); // TODO: set governor address
    address GOVERNOR = vm.envAddress("GOVERNOR");
    ICrossL2ProverV2 CROSS_L2_PROVER = ICrossL2ProverV2(0x03Fb5bFA4EB2Cba072A477A372bB87880A60fC96); // Testnet address

    bytes32 SALT = vm.envBytes32("SALT");

    ShieldedPool shieldedPool;

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

        poseidon2 = IPoseidon2(address(new Poseidon2{salt: SALT}()));
        ragequitVerifier = new RagequitVerifier{salt: SALT}();
        shieldedPool = new ShieldedPool{salt: SALT}(poseidon2, ragequitVerifier, CROSS_L2_PROVER, msg.sender);

        console.log("\nDeployment Results:");
        console.log("\nShieldedPool -->", address(shieldedPool));
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
            shieldedPool.addVerifier(params[i].verifier, params[i].inputs, params[i].outputs);

            string memory utxoType = string(bytes.concat(bytes(params[i].inputs.toString()), "x", bytes(params[i].outputs.toString()), " -->"));
            console.log("|--", utxoType, address(params[i].verifier));
        }

        // Transfer ownership to governor
        if (GOVERNOR != msg.sender) {
            shieldedPool.transferOwnership(GOVERNOR);
        }

        vm.stopBroadcast();
    }
}
