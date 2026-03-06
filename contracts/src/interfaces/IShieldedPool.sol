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

    function poseidon2() external view returns (IPoseidon2);
    function crossL2Prover() external view returns (ICrossL2ProverV2);

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