// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IShieldedPool} from "./interfaces/IShieldedPool.sol";
import {ICrossL2ProverV2} from "./interfaces/ICrossL2ProverV2.sol";

contract MasterTreeUpdater {

    uint64 public immutable MASTER_CHAIN_ID;

    ICrossL2ProverV2 public immutable crossL2Prover;

    IShieldedPool public immutable shieldedPool;

    constructor(IShieldedPool shieldedPool_, ICrossL2ProverV2 crossL2Prover_) {
        shieldedPool = shieldedPool_;
        crossL2Prover = crossL2Prover_;
        MASTER_CHAIN_ID = shieldedPool_.MASTER_CHAIN_ID();
    }

    function updateMasterTrees(bytes calldata proof) external {
        require(block.chainid != MASTER_CHAIN_ID, "MasterTreeUpdater: Cannot update master trees on master chain");
        // Verify event log proof and extract master tree event data
        (
            uint256 shieldedTreeId, 
            uint256 wormholeTreeId, 
            bytes32 masterShieldedRoot, 
            bytes32 masterWormholeRoot, 
            uint256 blockNumber, 
            uint256 timestamp
        ) = _verifyMasterTreeEvent(proof);
        // Update master trees
        bool success = shieldedPool.updateMasterTrees(
            shieldedTreeId, 
            wormholeTreeId, 
            masterShieldedRoot, 
            masterWormholeRoot, 
            blockNumber, 
            timestamp
        );
        require(success, "MasterTreeUpdater: Failed to update master trees");
    }

    // Verify and extract master tree event log from master chain
    function _verifyMasterTreeEvent(bytes calldata proof) internal returns (
        uint256 shieldedTreeId, 
        uint256 wormholeTreeId, 
        bytes32 masterShieldedRoot, 
        bytes32 masterWormholeRoot, 
        uint256 blockNumber, 
        uint256 timestamp
    ) {
        (
            uint32 chainId,
            address emittingContract,
            bytes memory topics,
            bytes memory unindexedData
        ) = crossL2Prover.validateEvent(proof);
        require(chainId == MASTER_CHAIN_ID, "MasterTreeUpdater: Invalid emitting chain id");
        require(emittingContract == address(shieldedPool), "MasterTreeUpdater: Invalid emitting contract");
        require(topics.length == 96, "MasterTreeUpdater: Invalid topics length");
        bytes32[] memory topicsArray = new bytes32[](3);
        assembly {
            let topicsPtr := add(topics, 32)
            // topics: [eventsignature, shieldedTreeRoot, wormholeTreeRoot]
            for { let i := 0 } lt(i, 3) { i := add(i, 1) } {
                mstore(
                    add(add(topicsArray, 32), mul(i, 32)),
                    mload(add(topicsPtr, mul(i, 32)))
                )
            }
        }
        require(topicsArray[0] == IShieldedPool.MasterTreesUpdated.selector, "MasterTreeUpdater: Invalid event signature");
        masterShieldedRoot = topicsArray[1];
        masterWormholeRoot = topicsArray[2];

        (shieldedTreeId, wormholeTreeId, blockNumber, timestamp) = abi.decode(unindexedData, (uint256, uint256, uint256, uint256));

        return (shieldedTreeId, wormholeTreeId, masterShieldedRoot, masterWormholeRoot, blockNumber, timestamp);
    }
}