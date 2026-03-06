// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {LeanIMT, LeanIMTData} from "./libraries/LeanIMT.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";
import {IShieldedPool} from "./interfaces/IShieldedPool.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IndexedMerkleTreeLib, IndexedMerkleTree} from "indexed-merkle-tree/contracts/src/IndexedMerkleTreePoseidon2.sol";
import {ICrossL2ProverV2} from "./interfaces/ICrossL2ProverV2.sol";

contract ShieldedPoolBranch is EIP712, Ownable {
    using LeanIMT for LeanIMTData;
    using IndexedMerkleTreeLib for IndexedMerkleTree;

    struct ShieldedTx {
        uint64 chainId;
        bytes32 wormholeRoot;
        bytes32 wormholeNullifier;
        bytes32 shieldedRoot;
        bytes32[] nullifiers;
        uint256[] commitments;
        IShieldedPool.Withdrawal[] withdrawals;
    }

    uint8 public constant MERKLE_TREE_DEPTH = 20;

    uint64 public constant MASTER_CHAIN_ID = 11155111;

    bytes32 private constant WITHDRAWAL_TYPEHASH = keccak256("Withdrawal(address to,address asset,uint256 id,uint256 amount,bytes32 confidentialContext)");
    bytes32 private constant SHIELDED_TX_TYPEHASH = keccak256("ShieldedTx(uint64 chainId,bytes32 wormholeRoot,bytes32 wormholeNullifier,bytes32 shieldedRoot,bytes32[] nullifiers,uint256[] commitments,Withdrawal[] withdrawals)Withdrawal(address to,address asset,uint256 id,uint256 amount,bytes32 confidentialContext)");

    IShieldedPool public immutable masterShieldedPool;
    IPoseidon2 public immutable poseidon2;
    ICrossL2ProverV2 public immutable crossL2Prover;

    uint256 public currentShieldedTreeId;

    mapping(uint256 inputs => mapping(uint256 outputs => IVerifier)) internal _utxoVerifiers;
    
    mapping(uint256 treeId => LeanIMTData) internal _branchShieldedTrees; // chain-specific whose root appends to master shielded tree

    mapping(uint64 chainId => uint256 lastBlockNumber) internal _lastBlockNumbers;

    event ShieldedTransfer(uint256 indexed treeId, uint256 startIndex, uint256[] commitments, bytes32[] nullifiers, IShieldedPool.Withdrawal[] withdrawals);

    event ShieldedTreeUpdated(
        uint256 indexed shieldedTreeId,
        uint256 indexed shieldedRoot, 
        uint256 blockNumber,
        uint256 blockTimestamp
    );

    event VerifierAdded(address verifier, uint256 inputs, uint256 outputs);

    constructor(IShieldedPool masterShieldedPool_, address governor_) EIP712("ShieldedPool", "1") Ownable(governor_) {
        masterShieldedPool = masterShieldedPool_;
        poseidon2 = masterShieldedPool_.poseidon2();
        _initializeMerkleTree(_branchShieldedTrees[currentShieldedTreeId]);
        crossL2Prover = masterShieldedPool_.crossL2Prover();
    }

    function branchShieldedTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_branchShieldedTrees[treeId].root()), _branchShieldedTrees[treeId].size, _branchShieldedTrees[treeId].depth);
    }

    // Owner functions
    function addVerifier(IVerifier verifier, uint256 inputs, uint256 outputs) external onlyOwner {
        require(address(verifier) != address(0), "ShieldedPool: verifier is zero address");
        // address existing = address(_utxoVerifiers[inputs][outputs]);
        // require(existing == address(0), "ShieldedPool: verifier already exists");
        require(inputs > 0 && outputs > 0, "ShieldedPool: invalid inputs or outputs");
        _utxoVerifiers[inputs][outputs] = verifier;
        emit VerifierAdded(address(verifier), inputs, outputs);
    }

    function shieldedTransfer(ShieldedTx memory shieldedTx, bytes calldata proof) external {
        bytes32 messageHash = _hashTypedData(shieldedTx);
        
        // Validate roots
        require(masterShieldedPool.isMasterWormholeRoot(shieldedTx.wormholeRoot), "ShieldedPool: wormhole root is not valid");
        require(masterShieldedPool.isMasterShieldedRoot(shieldedTx.shieldedRoot), "ShieldedPool: shielded root is not valid");

        // Validate nullifiers
        require(!masterShieldedPool.wormholeNullifierUsed(shieldedTx.wormholeNullifier), "ShieldedPool: wormhole nullifier is already used");
        for (uint256 i = 0; i < shieldedTx.nullifiers.length; i++) {
            require(!masterShieldedPool.nullifierUsed(shieldedTx.nullifiers[i]), "ShieldedPool: nullifier is already used");
        }

        // Get verifier
        IVerifier verifier = _utxoVerifiers[shieldedTx.nullifiers.length][shieldedTx.commitments.length + shieldedTx.withdrawals.length];
        require(address(verifier) != address(0), "ShieldedPool: verifier is not registered");

        // Get public inputs
        bytes32[] memory inputs = _formatPublicInputs(shieldedTx, messageHash);

        // Verify proof
        require(verifier.verify(proof, inputs), "ShieldedPool: proof is not valid");

        // Mark nullifiers as used
        masterShieldedPool.markWormholeNullifierUsed(shieldedTx.wormholeNullifier);
        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            masterShieldedPool.markShieldedNullifierUsed(shieldedTx.nullifiers[i]);
        }

        // Insert new commitments into shielded tree
        if (_isMerkleTreeSizeOverflow(_branchShieldedTrees[currentShieldedTreeId], shieldedTx.commitments.length)) {
            currentShieldedTreeId++;
            _initializeMerkleTree(_branchShieldedTrees[currentShieldedTreeId]);
        }
        uint256 startIndex = _branchShieldedTrees[currentShieldedTreeId].size;
        uint256 root = _branchShieldedTrees[currentShieldedTreeId].insertMany(shieldedTx.commitments);

        // If withdrawals are present, mint new shares for each withdrawal
        // for (uint256 i; i < shieldedTx.withdrawals.length; i++) {
        //     Withdrawal memory withdrawal = shieldedTx.withdrawals[i];
        //     IWormhole(withdrawal.asset).unshield(withdrawal.to, withdrawal.id, withdrawal.amount, withdrawal.confidentialContext);
        // }
        masterShieldedPool.unshield(shieldedTx.withdrawals);

        emit ShieldedTransfer(currentShieldedTreeId, startIndex, shieldedTx.commitments, shieldedTx.nullifiers, shieldedTx.withdrawals);

        emit ShieldedTreeUpdated(currentShieldedTreeId, root, block.number, block.timestamp);

        if (block.chainid == MASTER_CHAIN_ID) {
            // Insert branch shielded root into master shielded tree
            masterShieldedPool.insertShieldedMasterLeaf(block.chainid, root, block.number, block.timestamp);
        }
    }

    function updateMasterTrees(bytes calldata proof) external {
        (uint64 chainId,, bytes32 shieldedTreeRoot, uint256 blockNumber, uint256 timestamp) = _verifyAndExtractBranchTreeEvent(proof);
        masterShieldedPool.insertShieldedMasterLeaf(chainId, uint256(shieldedTreeRoot), blockNumber, timestamp);
    }

    // TODO: Verify and extract branch tree event log from branch chain
    function _verifyAndExtractBranchTreeEvent(bytes calldata proof) internal returns (uint64 chainId, uint256 shieldedTreeId, bytes32 shieldedTreeRoot, uint256 blockNumber, uint256 timestamp) {
        // TODO: Implement
        (
            uint32 emittingChainId,
            address emittingContract,
            bytes memory topics,
            bytes memory unindexedData
        ) = crossL2Prover.validateEvent(proof);
        chainId = uint64(emittingChainId);
        require(chainId != MASTER_CHAIN_ID && block.chainid == MASTER_CHAIN_ID, "Branch tree cannot be master chain");
        require(emittingContract == address(this), "Invalid emitting contract");
        require(topics.length == 96, "Invalid topics length");
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
        require(topicsArray[0] == ShieldedTreeUpdated.selector, "Invalid event signature");
        shieldedTreeId = uint256(topicsArray[1]);
        shieldedTreeRoot = topicsArray[2];

        // TODO: update this to handle rollbacks
        // Should change to conditional that handles rollback if blockNumber < _lastBlockNumbers[chainId] && blockTimestamp < _lastBlockTimestamps[chainId]
        (blockNumber, timestamp) = abi.decode(unindexedData, (uint256, uint256));
        require(blockNumber > _lastBlockNumbers[chainId], "Branch tree event is not new");
        _lastBlockNumbers[chainId] = blockNumber;

        return (chainId, shieldedTreeId, shieldedTreeRoot, blockNumber, timestamp);
    }

    function _formatPublicInputs(ShieldedTx memory shieldedTx, bytes32 messageHash) internal view returns (bytes32[] memory inputs) {
        // Split 256-bit message hash into two 128-bit halves (matches circuit output)
        uint256 hashUint = uint256(messageHash);
        bytes32 messageHashHi = bytes32(hashUint >> 128);
        bytes32 messageHashLo = bytes32(hashUint & type(uint128).max);

        // Public inputs ordering: pub params first, then return values
        // Pub params: chain_id, shielded_root, wormhole_root
        // Return values: hashed_message_hi, hashed_message_lo, wormhole_nullifier, nullifiers[], commitments[]
        uint256 offset = 6 + shieldedTx.nullifiers.length;
        inputs = new bytes32[](offset + shieldedTx.commitments.length + shieldedTx.withdrawals.length);
        inputs[0] = bytes32(block.chainid);
        inputs[1] = shieldedTx.shieldedRoot;
        inputs[2] = shieldedTx.wormholeRoot;
        inputs[3] = messageHashHi;
        inputs[4] = messageHashLo;
        inputs[5] = shieldedTx.wormholeNullifier;
        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            inputs[6 + i] = shieldedTx.nullifiers[i];
        }
        for (uint256 i; i < shieldedTx.commitments.length; i++) {
            inputs[offset + i] = bytes32(shieldedTx.commitments[i]);
        }
        for (uint256 i; i < shieldedTx.withdrawals.length; i++) {
            IShieldedPool.Withdrawal memory withdrawal = shieldedTx.withdrawals[i];
            uint256 commitment = _getCommitment(
                uint256(uint160(withdrawal.to)), 
                uint256(uint160(withdrawal.asset)),
                withdrawal.id,
                withdrawal.amount, 
                2 // Transfer Type: WITHDRAWAL
            );
            inputs[offset + shieldedTx.commitments.length + i] = bytes32(commitment);
        }
    }

    function _getCommitment(uint256 recipientHash, uint256 token, uint256 tokenId, uint256 amount, uint256 transferType) internal view returns (uint256) {
        return poseidon2.hash_5(recipientHash, token, tokenId, amount, transferType);
    }

    function _initializeMerkleTree(LeanIMTData storage tree) internal returns (uint256 root) {
        return tree.init(address(poseidon2));
    }

    function _isMerkleTreeFull(LeanIMTData storage tree) internal view returns (bool) {
        return tree.size == 2 ** MERKLE_TREE_DEPTH;
    }

    function _isMerkleTreeSizeOverflow(LeanIMTData storage tree, uint256 batchSize) internal view returns (bool) {
        return tree.size + batchSize > 2 ** MERKLE_TREE_DEPTH;
    }

    // EIP712 helper functions
    function _hashTypedData(ShieldedTx memory shieldedTx) internal view returns (bytes32) {
        bytes32[] memory withdrawalsHash = new bytes32[](shieldedTx.withdrawals.length);
        for (uint256 i; i < shieldedTx.withdrawals.length; i++) {
            withdrawalsHash[i] = keccak256(
                abi.encode(
                    WITHDRAWAL_TYPEHASH, 
                    shieldedTx.withdrawals[i].to, 
                    shieldedTx.withdrawals[i].asset, 
                    shieldedTx.withdrawals[i].id, 
                    shieldedTx.withdrawals[i].amount,
                    shieldedTx.withdrawals[i].confidentialContext
                )
            );
        }
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SHIELDED_TX_TYPEHASH,
                    shieldedTx.chainId,
                    shieldedTx.wormholeRoot,
                    shieldedTx.wormholeNullifier,
                    shieldedTx.shieldedRoot,
                    keccak256(abi.encodePacked(shieldedTx.nullifiers)),
                    keccak256(abi.encodePacked(shieldedTx.commitments)),
                    keccak256(abi.encodePacked(withdrawalsHash))
                )
            )
        );
    }
}