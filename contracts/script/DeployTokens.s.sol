// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";
import {WETHWormhole} from "../src/wormholes/WETHWormhole.sol";
import {ERC20Wormhole} from "../src/wormholes/ERC20Wormhole.sol";
import {ERC4626Wormhole} from "../src/wormholes/ERC4626Wormhole.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract DeployTokensScript is Script {
    using Strings for *;

    ShieldedPool shieldedPool = ShieldedPool(vm.envAddress("SHIELDED_POOL"));
    WETHWormhole wethWormhole;
    ERC20Wormhole erc20Wormhole;
    ERC4626Wormhole erc4626Wormhole;

    bytes32 SALT = vm.envBytes32("SALT");

    // Update to chain specific addresses
    IERC20Metadata erc20 = IERC20Metadata(address(0)); // TODO: set ERC20 address
    IERC20Metadata erc4626 = IERC20Metadata(address(0)); // TODO: set ERC4626 address
    
    function run() public {
        vm.startBroadcast();

        // ragequitVerifier = new RagequitVerifier();
        wethWormhole = new WETHWormhole{salt: SALT}(shieldedPool);
        erc20Wormhole = new ERC20Wormhole{salt: SALT}(shieldedPool, "zkWormhole Wrapped", "zk");
        erc4626Wormhole = new ERC4626Wormhole{salt: SALT}(shieldedPool);

        // initialize wormhole tokens
        erc20Wormhole.initialize(abi.encodePacked(erc20));
        erc4626Wormhole.initialize(abi.encodePacked(erc4626));

        // add utxo verifiers
        console.log("\nDeployed tokens:");
        console.log("|-- WETH Wormhole -->", address(wethWormhole));
        console.log("|-- ERC20 Wormhole -->", address(erc20Wormhole));
        console.log("   |-- Wrapper for", erc20.name(), "-->", address(erc20));
        console.log("|-- ERC4626 Wormhole -->", address(erc4626Wormhole));
        console.log("   |-- Wrapper for", erc4626.name(), "-->", address(erc4626));

        vm.stopBroadcast();
    }
}
