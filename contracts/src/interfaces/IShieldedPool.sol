// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {ICrossL2ProverV2} from "./ICrossL2ProverV2.sol";

interface IShieldedPool {
    struct WormholePreCommitment {
        uint256 entryId;
        bool    approved;
    }

    struct Withdrawal {
        address to;
        address asset;
        uint256 id;
        uint256 amount;
        bytes32 confidentialContext;
    }

    event WormholeEntry(uint256 indexed entryId, address indexed token, address indexed from, address to, uint256 id, uint256 amount, bytes32 confidentialContext);
    event WormholeCommitment(uint256 indexed entryId, uint256 indexed commitment, uint256 treeId, uint256 leafIndex, address token, uint256 tokenId, address from, address to, uint256 amount, bool approved);
    event WormholeNullifier(bytes32 indexed nullifier);

    event WormholeTreeUpdated(uint256 indexed treeId, uint256 indexed root, uint256 indexed blockNumber, uint256 blockTimestamp);

    event MasterTreesUpdated(
        uint256 shieldedTreeId,
        uint256 wormholeTreeId,
        uint256 indexed masterShieldedRoot,
        uint256 indexed masterWormholeRoot,
        uint256 blockNumber,
        uint256 blockTimestamp
    );

    event MasterShieldedTreeLeaf(uint256 indexed treeId, uint256 indexed branchRoot, uint256 indexed branchChainId, uint256 branchBlockNumber, uint256 branchTimestamp);
    event MasterWormholeTreeLeaf(uint256 indexed treeId, uint256 indexed branchRoot, uint256 indexed branchChainId, uint256 branchBlockNumber, uint256 branchTimestamp);

    event Ragequit(uint256 indexed entryId, address indexed quitter, address indexed returnedTo, address asset, uint256 id, uint256 amount);

    event VerifierAdded(address verifier, uint256 inputs, uint256 outputs);
    event WormholeApproverSet(address indexed approver, bool isApprover);
    event BranchAdded(uint64 indexed chainId, address indexed branch);

    function poseidon2() external view returns (IPoseidon2);

    function MASTER_CHAIN_ID() external view returns (uint64);
    function isSyncingPaused() external view returns (bool);
    function lastSyncedBlockNumber() external view returns (uint256);
    function lastSyncedTimestamp() external view returns (uint256);

    function updateMasterTrees(
        uint256 newShieldedTreeId, 
        uint256 newWormholeTreeId, 
        bytes32 newMasterShieldedRoot, 
        bytes32 newMasterWormholeRoot, 
        uint256 blockNumber, 
        uint256 timestamp
    ) external returns (bool);

    function requestWormholeEntry(address from, address to, uint256 id, uint256 amount, bytes32 confidentialContext) external returns (uint256 index);
    function initiateRagequit(uint256 entryId) external;
    function appendWormholeLeaf(uint256 entryId, bool approved) external;
    function appendManyWormholeLeaves(WormholePreCommitment[] memory nodes) external;

    function isMasterShieldedRoot(bytes32 root) external view returns (bool);
    function isMasterWormholeRoot(bytes32 root) external view returns (bool);

    function wormholeNullifierUsed(bytes32 nullifier) external view returns (bool);
    function nullifierUsed(bytes32 nullifier) external view returns (bool);

    function markShieldedNullifierUsed(bytes32 nullifier) external;
    function markWormholeNullifierUsed(bytes32 nullifier) external;

    function unshield(Withdrawal[] calldata withdrawals) external;

    function insertShieldedMasterLeaf(uint256 chainId, uint256 shieldedRoot, uint256 blockNumber, uint256 blockTimestamp) external;
}