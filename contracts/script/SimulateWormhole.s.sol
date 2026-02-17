// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {MockVerifier} from "../test/mock/MockVerifier.sol"; // TODO: use real verifiers
import {ERC20Wormhole} from "../src/wormholes/ERC20Wormhole.sol";
import {MockERC20} from "../test/mock/MockERC20.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {ICrossL2ProverV2} from "../src/interfaces/ICrossL2ProverV2.sol";

contract SimulateWormholeScript is Script {
    using Strings for *;

    address GOVERNOR = address(0x1); // TODO: set governor address
    address BURN_ADDRESS = address(0xDEAD);
    
    ICrossL2ProverV2 CROSS_L2_PROVER = ICrossL2ProverV2(address(0x2));

    ShieldedPool shieldedPool;

    IPoseidon2 poseidon2;
    IVerifier ragequitVerifier;

    MockERC20 underlying;
    ERC20Wormhole wormholeWrapper;    

    struct AddUTXOVerifierParams {
        uint256   inputs;
        uint256   outputs;
        IVerifier verifier;
    }
    
    function run() public {
        vm.startBroadcast();

        poseidon2 = IPoseidon2(address(new Poseidon2()));
        ragequitVerifier = new MockVerifier();
        shieldedPool = new ShieldedPool(poseidon2, ragequitVerifier, CROSS_L2_PROVER, msg.sender);

        console.log("\nDeployment Results:");
        console.log("\nShieldedPool -->", address(shieldedPool));
        console.log("|-- Poseidon2 -->", address(poseidon2));
        console.log("|-- Ragequit verifier -->", address(ragequitVerifier));
        console.log("|-- Governor -->", GOVERNOR);

        // add utxo verifiers
        AddUTXOVerifierParams[] memory params = new AddUTXOVerifierParams[](2);
        params[0] = AddUTXOVerifierParams({
            inputs: 2,
            outputs: 2,
            verifier: new MockVerifier()
        });
        params[1] = AddUTXOVerifierParams({
            inputs: 2,
            outputs: 3,
            verifier: new MockVerifier()
        });

        console.log("\nAdding UTXO verifiers:");
        for (uint256 i; i < params.length; i++) {
            shieldedPool.addVerifier(params[i].verifier, params[i].inputs, params[i].outputs);

            string memory utxoType = string(bytes.concat(bytes(params[i].inputs.toString()), "x", bytes(params[i].outputs.toString()), " -->"));
            console.log("|--", utxoType, address(params[i].verifier));
        }

        console.log("\nSetting wormhole entry approver:");
        shieldedPool.setWormholeApprover(msg.sender, true);
        console.log("|-- Approver -->", msg.sender);

        // create underlying token
        underlying = new MockERC20();

        // create and set wormhole pool implementation
        wormholeWrapper = new ERC20Wormhole(shieldedPool, "ShieldedPool Wrapped", "spw");

        // deposit underlying token
        console.log("\nDepositing underlying token and sending to burn address:");
        underlying.mint(msg.sender, 100_000_000e18);
        underlying.approve(address(wormholeWrapper), 100_000_000e18);
        wormholeWrapper.depositFor(BURN_ADDRESS, 100_000_000e18);

        console.log("|-- Burn address -->", BURN_ADDRESS);
        console.log("    |-- Sent:", 100_000_000e18, wormholeWrapper.symbol());

        vm.stopBroadcast();
    }
}
