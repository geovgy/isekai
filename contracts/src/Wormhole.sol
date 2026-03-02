// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IShieldedPool} from "./interfaces/IShieldedPool.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";

abstract contract Wormhole is IWormhole {
    
    IShieldedPool public immutable shieldedPool;
    
    modifier onlyShieldedPool() {
        require(msg.sender == address(shieldedPool), "Wormhole: caller is not shielded pool");
        _;
    }
    
    constructor(IShieldedPool shieldedPool_) {
        shieldedPool = shieldedPool_;
    }

    // Override this function to unshield the asset
    function _unshield(address to, uint256 id, uint256 amount, bytes32 confidentialContext) internal virtual {}

    // Override this function to return the actual supply of the asset
    function actualSupply() public virtual view returns (uint256) {}

    function unshield(address to, uint256 id, uint256 amount, bytes32 confidentialContext) external onlyShieldedPool {
        _unshield(to, id, amount, confidentialContext);
        emit Unshield(to, id, amount, confidentialContext);
    }

    function _isWormholeEligible(address to, uint256 amount) internal pure returns (bool) {
        return to != address(0) && amount > 0;
    }

    function _requestWormholeEntry(address from, address to, uint256 id, uint256 amount, bytes32 confidentialContext) internal returns (bool submitted, uint256 pendingIndex) {
        if (!_isWormholeEligible(to, amount)) {
            return (false, 0);
        }
        pendingIndex = shieldedPool.requestWormholeEntry(from, to, id, amount, confidentialContext);
        return (true, pendingIndex);
    }
}