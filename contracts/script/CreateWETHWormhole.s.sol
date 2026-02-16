// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Kamui} from "../src/Kamui.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {MockVerifier} from "../test/mock/MockVerifier.sol"; // TODO: use real verifiers
import {HonkVerifier as UTXO2x2Verifier} from "../src/verifiers/UTXO2x2Verifier.sol";
import {HonkVerifier as RagequitVerifier} from "../src/verifiers/RagequitVerifier.sol";
import {WETHWormhole} from "../src/wormholes/WETHWormhole.sol";
import {ERC20Wormhole} from "../src/wormholes/ERC20Wormhole.sol";
import {ERC4626Wormhole} from "../src/wormholes/ERC4626Wormhole.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract CreateWETHWormholeScript is Script {
    Kamui kamui = Kamui(vm.envAddress("KAMUI"));
    WETHWormhole wethImplementation = WETHWormhole(payable(vm.envAddress("WETHWORMHOLE")));

    WETHWormhole newWethImplementation;

    function run() public {
        vm.startBroadcast();

        console.log("Using Kamui -->", address(kamui));
        console.log("Replacing WETHWormhole -->", address(wethImplementation));
        newWethImplementation = new WETHWormhole(kamui);
        console.log("|-- New WETHWormhole -->", address(newWethImplementation));

        console.log("\nLaunching WETH Wormhole Asset:");
        console.log("|-- WETH Wormhole Asset -->", address(newWethImplementation));

        vm.stopBroadcast();
    }
}
