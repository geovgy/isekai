// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IShieldedPool} from "./IShieldedPool.sol";

interface IWormhole {
    event Unshield(address to, uint256 id, uint256 amount);

    function shieldedPool() external view returns (IShieldedPool);
    function actualSupply() external view returns (uint256);
    function unshield(address to, uint256 id, uint256 amount) external;
}