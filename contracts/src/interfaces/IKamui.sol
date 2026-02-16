// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

interface IKamui {
    struct WormholePreCommitment {
        uint256 entryId;
        bool    approved;
    }

    function requestWormholeEntry(address from, address to, uint256 id, uint256 amount) external returns (uint256 index);
    function initiateRagequit(uint256 entryId) external;
    function appendWormholeLeaf(uint256 entryId, bool approved) external;
    function appendManyWormholeLeaves(WormholePreCommitment[] memory nodes) external;
}