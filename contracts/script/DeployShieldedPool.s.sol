// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {ShieldedPoolDelegateBranch} from "../src/ShieldedPoolDelegateBranch.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {IShieldedPool} from "../src/interfaces/IShieldedPool.sol";
import {HonkVerifier as RagequitVerifier} from "../src/verifiers/ragequit_verifier.sol";
import {HonkVerifier as DelegatedUTXO2x2Verifier} from "../src/verifiers/delegated_utxo_2x2_verifier.sol";
import {HonkVerifier as BatchDelegatedUTXO2x2Verifier} from "../src/verifiers/batch_delegated_utxo_2x2_verifier.sol";
import {HonkVerifier as DelegateRevocationVerifier} from "../src/verifiers/revoke_delegation_verifier.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {ICrossL2ProverV2} from "../src/interfaces/ICrossL2ProverV2.sol";

contract DeployShieldedPoolScript is Script {
    using Strings for *;

    // address GOVERNOR = address(0x1); // TODO: set governor address
    address GOVERNOR = vm.envAddress("GOVERNOR");
    ICrossL2ProverV2 CROSS_L2_PROVER = ICrossL2ProverV2(0x03Fb5bFA4EB2Cba072A477A372bB87880A60fC96); // Testnet address

    bytes32 SALT = vm.envBytes32("SALT");

    ShieldedPool shieldedPool;
    ShieldedPoolDelegateBranch shieldedPoolDelegateBranch;

    IPoseidon2 poseidon2;
    IVerifier ragequitVerifier;
    IVerifier delegatedUtxo2x2Verifier;
    IVerifier batchDelegatedUtxo2x2Verifier;

    struct AddVerifierParams {
        uint256   inputs;
        uint256   outputs;
        IVerifier verifier;
    }

    struct AddBatchVerifierParams {
        uint256 batchSize;
        uint256 inputs;
        uint256 outputs;
        IVerifier verifier;
    }
    
    function run() public {
        vm.startBroadcast();

        assert(GOVERNOR != address(0));

        poseidon2 = IPoseidon2(address(new Poseidon2{salt: SALT}()));
        ragequitVerifier = IVerifier(address(new RagequitVerifier{salt: SALT}()));
        shieldedPool = new ShieldedPool{salt: SALT}(poseidon2, ragequitVerifier, CROSS_L2_PROVER, msg.sender);
        shieldedPoolDelegateBranch =
            new ShieldedPoolDelegateBranch{salt: SALT}(IShieldedPool(address(shieldedPool)), IVerifier(address(new DelegateRevocationVerifier{salt: SALT}())), msg.sender);

        delegatedUtxo2x2Verifier = IVerifier(address(new DelegatedUTXO2x2Verifier()));
        batchDelegatedUtxo2x2Verifier = IVerifier(address(new BatchDelegatedUTXO2x2Verifier()));

        console.log("\nDeployment Results:");
        console.log("\nShieldedPool -->", address(shieldedPool));
        console.log("|-- Delegate branch -->", address(shieldedPoolDelegateBranch));
        console.log("|-- Poseidon2 -->", address(poseidon2));
        console.log("|-- Ragequit verifier -->", address(ragequitVerifier));
        console.log("|-- Delegated UTXO2x2 verifier -->", address(delegatedUtxo2x2Verifier));
        console.log("|-- Governor -->", GOVERNOR);

        console.log("\nShieldedPool Delegate Branch -->", address(shieldedPoolDelegateBranch));
        console.log("|-- ShieldedPool -->", address(shieldedPool));
        console.log("|-- Governor -->", GOVERNOR);

        // add delegated branch verifiers
        AddVerifierParams[] memory params = new AddVerifierParams[](1);
        params[0] = AddVerifierParams({
            inputs: 2,
            outputs: 2,
            verifier: delegatedUtxo2x2Verifier
        });

        console.log("\nAdding delegated branch UTXO verifiers:");
        for (uint256 i; i < params.length; i++) {
            shieldedPoolDelegateBranch.addVerifier(params[i].verifier, params[i].inputs, params[i].outputs);

            string memory utxoType = string(bytes.concat(bytes(params[i].inputs.toString()), "x", bytes(params[i].outputs.toString()), " -->"));
            console.log("|--", utxoType, address(params[i].verifier));
        }

        // add batch delegated branch verifiers
        AddBatchVerifierParams[] memory batchParams = new AddBatchVerifierParams[](1);
        batchParams[0] = AddBatchVerifierParams({
            batchSize: 2,
            inputs: 2,
            outputs: 2,
            verifier: batchDelegatedUtxo2x2Verifier
        });

        console.log("\nAdding batch delegated branch UTXO verifiers:");
        for (uint256 i; i < batchParams.length; i++) {
            shieldedPoolDelegateBranch.addBatchVerifier(batchParams[i].verifier, batchParams[i].batchSize, batchParams[i].inputs, batchParams[i].outputs);

            string memory batchUtxoType = string(bytes.concat(bytes(batchParams[i].batchSize.toString()), "x", bytes(batchParams[i].inputs.toString()), "x", bytes(batchParams[i].outputs.toString()), " -->"));
            console.log("|--", batchUtxoType, address(batchParams[i].verifier));
        }

        // Transfer ownership to governor
        if (GOVERNOR != msg.sender) {
            shieldedPool.transferOwnership(GOVERNOR);
            shieldedPoolDelegateBranch.transferOwnership(GOVERNOR);
        }

        vm.stopBroadcast();
    }
}
