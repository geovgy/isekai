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

contract ShieldedPool is IShieldedPool, EIP712, Ownable {
    using LeanIMT for LeanIMTData;
    using IndexedMerkleTreeLib for IndexedMerkleTree;

    struct TransferMetadata {
        address from;
        address to;
        address asset;
        uint256 id;
        uint256 amount;
    }

    struct Withdrawal {
        address to;
        address asset;
        uint256 id;
        uint256 amount;
    }

    struct ShieldedTx {
        uint64 chainId;
        bytes32 wormholeRoot;
        bytes32 wormholeNullifier;
        bytes32 shieldedRoot;
        bytes32[] nullifiers;
        uint256[] commitments;
        Withdrawal[] withdrawals;
    }

    struct RagequitTx {
        uint256 entryId;
        bool    approved;
        bytes32 wormholeRoot;
        bytes32 wormholeNullifier;
    }

    struct BranchInfo {
        uint64 chainId;
        uint256 prevIndex;
        bytes32 shieldedRoot;
        bytes32 wormholeRoot;
        uint256 shieldedTreeId;
        uint256 wormholeTreeId;
        uint256 blockNumber;
        uint256 blockTimestamp;
    }

    uint8 public constant MERKLE_TREE_DEPTH = 20;

    uint8 public constant ROLLBACK_TREE_DEPTH = 32;

    bytes32 public constant WITHDRAWAL_TYPEHASH = keccak256("Withdrawal(address to,address asset,uint256 id,uint256 amount)");
    bytes32 public constant SHIELDED_TX_TYPEHASH = keccak256("ShieldedTx(uint64 chainId,bytes32 wormholeRoot,bytes32 wormholeNullifier,bytes32 shieldedRoot,bytes32[] nullifiers,uint256[] commitments,Withdrawal[] withdrawals)Withdrawal(address to,address asset,uint256 id,uint256 amount)");

    IPoseidon2 public immutable poseidon2;
    IVerifier public immutable ragequitVerifier;
    ICrossL2ProverV2 public immutable crossL2Prover;

    uint256 public currentShieldedTreeId;
    uint256 public currentWormholeTreeId;

    uint256 public totalWormholeEntries;
    uint256 public totalWormholeCommitments;

    mapping(address approver => bool) internal _isWormholeApprover;

    mapping(uint256 entryId => bool) internal _wormholeEntriesCommitted;
    mapping(uint256 entryId => TransferMetadata) internal _wormholeEntries;

    mapping(bytes32 nullifier => bool) public wormholeNullifierUsed;
    mapping(bytes32 nullifier => bool) public nullifierUsed;

    mapping(bytes32 root => bool) public isMasterWormholeRoot;
    mapping(bytes32 root => bool) public isMasterShieldedRoot;

    mapping(uint256 inputs => mapping(uint256 outputs => IVerifier)) internal _utxoVerifiers;
    
    mapping(uint256 treeId => LeanIMTData) internal _masterShieldedTrees;
    mapping(uint256 treeId => LeanIMTData) internal _masterWormholeTrees;
    
    mapping(uint256 treeId => LeanIMTData) internal _branchShieldedTrees; // chain-specific whose root appends to master shielded tree
    mapping(uint256 treeId => LeanIMTData) internal _branchWormholeTrees; // chain-specific whose root appends to master wormhole tree

    mapping(uint64 chainId => uint256 lastBlockNumber) internal _lastBlockNumbers;

    // TODO: implement rollback tree in shieldedTransfer function and public inputs
    IndexedMerkleTree public rollbackTree;
    mapping(uint64 chainId => uint256 index) internal _currentBranchIndices;
    mapping(uint64 chainId => mapping(uint256 index => BranchInfo)) internal _branchInfos; // for tracking possible chain rollbacks

    event WormholeEntry(uint256 indexed entryId, address indexed token, address indexed from, address to, uint256 id, uint256 amount);
    event WormholeCommitment(uint256 indexed entryId, uint256 indexed commitment, uint256 treeId, uint256 leafIndex, bytes32 assetId, address from, address to, uint256 amount, bool approved);
    event WormholeNullifier(bytes32 indexed nullifier);

    event ShieldedTransfer(uint256 indexed treeId, uint256 startIndex, uint256[] commitments, bytes32[] nullifiers, Withdrawal[] withdrawals);

    event BranchTreesUpdated(
        uint256 shieldedTreeId,
        uint256 wormholeTreeId,
        uint256 indexed branchShieldedRoot, 
        uint256 indexed branchWormholeRoot,
        uint256 blockNumber,
        uint256 blockTimestamp
    );

    event MasterTreesUpdated(
        uint256 indexed masterShieldedRoot,
        uint256 indexed masterWormholeRoot,
        uint256 blockNumber,
        uint256 blockTimestamp
    );

    event Ragequit(uint256 indexed entryId, address indexed quitter, address indexed returnedTo, address asset, uint256 id, uint256 amount);

    event VerifierAdded(address verifier, uint256 inputs, uint256 outputs);
    event WormholeApproverSet(address indexed approver, bool isApprover);

    constructor(IPoseidon2 poseidon2_, IVerifier ragequitVerifier_, ICrossL2ProverV2 crossL2Prover_, address governor_) EIP712("ShieldedPool", "1") Ownable(governor_) {
        poseidon2 = poseidon2_;
        _initializeMerkleTree(_branchShieldedTrees[currentShieldedTreeId]);
        _initializeMerkleTree(_branchWormholeTrees[currentWormholeTreeId]);
        uint256 shieldedRoot = _initializeMerkleTree(_masterShieldedTrees[currentShieldedTreeId]);
        uint256 wormholeRoot = _initializeMerkleTree(_masterWormholeTrees[currentWormholeTreeId]);
        isMasterShieldedRoot[bytes32(shieldedRoot)] = true;
        isMasterWormholeRoot[bytes32(wormholeRoot)] = true;
        ragequitVerifier = ragequitVerifier_;
        crossL2Prover = crossL2Prover_;

        rollbackTree.init(address(poseidon2), ROLLBACK_TREE_DEPTH);
    }

    function branchWormholeTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_branchWormholeTrees[treeId].root()), _branchWormholeTrees[treeId].size, _branchWormholeTrees[treeId].depth);
    }

    function masterWormholeTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_masterWormholeTrees[treeId].root()), _masterWormholeTrees[treeId].size, _masterWormholeTrees[treeId].depth);
    }

    function branchShieldedTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_branchShieldedTrees[treeId].root()), _branchShieldedTrees[treeId].size, _branchShieldedTrees[treeId].depth);
    }

    function masterShieldedTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_masterShieldedTrees[treeId].root()), _masterShieldedTrees[treeId].size, _masterShieldedTrees[treeId].depth);
    }

    function wormholeEntry(uint256 entryId) external view returns (TransferMetadata memory) {
        return _wormholeEntries[entryId];
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

    function setWormholeApprover(address approver, bool isApprover) external onlyOwner {
        _isWormholeApprover[approver] = isApprover;
        emit WormholeApproverSet(approver, isApprover);
    }

    function _getWormholeCommitment(uint256 entryId, bool approved, address from, address to, bytes32 assetId, uint256 amount) internal view returns (uint256) {
        uint256 idHash = poseidon2.hash_2(block.chainid, entryId);
        return poseidon2.hash_6(idHash, approved ? 1 : 0, uint256(uint160(from)), uint256(uint160(to)), uint256(assetId), amount);
    }

    function appendWormholeLeaf(uint256 entryId, bool approved) external {
        require(_isWormholeApprover[msg.sender], "ShieldedPool: caller is not a wormhole approver");
        _appendWormholeLeaf(entryId, approved, false);
    }

    // Appends leaf as rejected entry to wormhole tree
    // Original sender can auto-reject their own entry to expedite ragequitting
    function initiateRagequit(uint256 entryId) external {
        _appendWormholeLeaf(entryId, false, true);
    }

    function _appendWormholeLeaf(uint256 entryId, bool approved, bool isRagequit) internal {
        require(entryId < totalWormholeEntries, "ShieldedPool: entry id does not exist");
        require(!_wormholeEntriesCommitted[entryId], "ShieldedPool: entry is already committed in wormhole tree");
        TransferMetadata memory entry = _wormholeEntries[entryId];
        if (isRagequit) {
            require(entry.from == msg.sender, "ShieldedPool: caller is not the original sender");
            require(!approved, "ShieldedPool: entry cannot be appended as approved");
        }
        bytes32 assetId = _getAssetId(entry.asset, entry.id);
        uint256 commitment = _getWormholeCommitment(entryId, approved, entry.from, entry.to, assetId, entry.amount);
        if (_isMerkleTreeFull(_branchWormholeTrees[currentWormholeTreeId])) {
            currentWormholeTreeId++;
            _initializeMerkleTree(_branchWormholeTrees[currentWormholeTreeId]);
        }
        uint256 root = _branchWormholeTrees[currentWormholeTreeId].insert(commitment);
        _wormholeEntriesCommitted[entryId] = true;
        unchecked {
            totalWormholeCommitments++;
        }
        emit WormholeCommitment(entryId, commitment, currentWormholeTreeId, _branchWormholeTrees[currentWormholeTreeId].size - 1, assetId, entry.from, entry.to, entry.amount, approved);

        if (block.chainid == 1) {
            // Insert branch wormhole root into master wormhole tree
            if (_isMerkleTreeFull(_masterWormholeTrees[currentWormholeTreeId])) {
                currentWormholeTreeId++;
                _initializeMerkleTree(_masterWormholeTrees[currentWormholeTreeId]);
            }
            uint256 newMasterWormholeRoot = _masterWormholeTrees[currentWormholeTreeId].insert(root);
            isMasterWormholeRoot[bytes32(newMasterWormholeRoot)] = true;
            emit MasterTreesUpdated(newMasterWormholeRoot, _masterShieldedTrees[currentShieldedTreeId].root(), block.number, block.timestamp);
        } else {
            emit BranchTreesUpdated(currentWormholeTreeId, currentWormholeTreeId, _branchShieldedTrees[currentShieldedTreeId].root(), root, block.number, block.timestamp);
        }
    }

    function appendManyWormholeLeaves(WormholePreCommitment[] memory nodes) external {
        require(_isWormholeApprover[msg.sender], "ShieldedPool: caller is not a wormhole approver");
        require(nodes.length > 0 && nodes.length <= (2 ** MERKLE_TREE_DEPTH) / 5, "ShieldedPool: invalid nodes length");
        for (uint256 i = 0; i < nodes.length; i++) {
            require(!_wormholeEntriesCommitted[nodes[i].entryId], "ShieldedPool: entry is already committed in wormhole tree");
            require(nodes[i].entryId < totalWormholeEntries, "ShieldedPool: entry id does not exist");
        }
        if (_isMerkleTreeSizeOverflow(_branchWormholeTrees[currentWormholeTreeId], nodes.length)) {
            currentWormholeTreeId++;
            _initializeMerkleTree(_branchWormholeTrees[currentWormholeTreeId]);
        }
        uint256[] memory commitments = new uint256[](nodes.length);
        uint256 startLeafIndex = _branchWormholeTrees[currentWormholeTreeId].size;
        for (uint256 i = 0; i < nodes.length; i++) {
            TransferMetadata memory entry = _wormholeEntries[nodes[i].entryId];
            bytes32 assetId = _getAssetId(entry.asset, entry.id);
            commitments[i] = _getWormholeCommitment(nodes[i].entryId, nodes[i].approved, entry.from, entry.to, assetId, entry.amount);
            _wormholeEntriesCommitted[nodes[i].entryId] = true;
            emit WormholeCommitment(
                nodes[i].entryId,
                commitments[i],
                currentWormholeTreeId,
                startLeafIndex + i,
                assetId,
                entry.from,
                entry.to,
                entry.amount,
                nodes[i].approved
            );
        }
        uint256 root = _branchWormholeTrees[currentWormholeTreeId].insertMany(commitments);
        unchecked {
            totalWormholeCommitments += nodes.length;
        }
        if (block.chainid == 1) {
            // Insert branch wormhole root into master wormhole tree
            if (_isMerkleTreeFull(_masterWormholeTrees[currentWormholeTreeId])) {
                currentWormholeTreeId++;
                _initializeMerkleTree(_masterWormholeTrees[currentWormholeTreeId]);
            }
            uint256 newMasterWormholeRoot = _masterWormholeTrees[currentWormholeTreeId].insert(root);
            isMasterWormholeRoot[bytes32(newMasterWormholeRoot)] = true;
            emit MasterTreesUpdated(newMasterWormholeRoot, _masterShieldedTrees[currentShieldedTreeId].root(), block.number, block.timestamp);
        } else {
            emit BranchTreesUpdated(currentWormholeTreeId, currentWormholeTreeId, _branchShieldedTrees[currentShieldedTreeId].root(), root, block.number, block.timestamp);
        }
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

    function updateMasterTrees(bytes calldata proof) external {
        if (block.chainid == 1) {
            (bytes32 branchShieldedRoot, bytes32 branchWormholeRoot) = _verifyAndExtractBranchTreeEvent(proof);
            (uint256 masterShieldedRoot, uint256 masterWormholeRoot) = _insertMasterTrees(uint256(branchShieldedRoot), uint256(branchWormholeRoot));
            emit MasterTreesUpdated(masterShieldedRoot, masterWormholeRoot, block.number, block.timestamp);
        } else {
            (bytes32 masterShieldedRoot, bytes32 masterWormholeRoot) = _verifyMasterTreeEvent(proof);
            isMasterShieldedRoot[bytes32(masterShieldedRoot)] = true;
            isMasterWormholeRoot[bytes32(masterWormholeRoot)] = true;
            // TODO: emit event of received master trees
        }
    }

    // TODO: Verify and extract branch tree event log from branch chain
    function _verifyAndExtractBranchTreeEvent(bytes calldata proof) internal returns (bytes32 branchShieldedRoot, bytes32 branchWormholeRoot) {
        // TODO: Implement
        (
            uint32 chainId,
            address emittingContract,
            bytes memory topics,
            bytes memory unindexedData
        ) = crossL2Prover.validateEvent(proof);
        require(chainId != 1, "Branch tree cannot be master chain");
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
        bytes32 shieldedTreeRoot = topicsArray[1];
        bytes32 wormholeTreeRoot = topicsArray[2];

        // TODO: update this to handle rollbacks
        // Should change to conditional that handles rollback if blockNumber < _lastBlockNumbers[chainId] && blockTimestamp < _lastBlockTimestamps[chainId]
        (,,uint256 blockNumber,) = abi.decode(unindexedData, (uint256, uint256, uint256, uint256));
        require(blockNumber > _lastBlockNumbers[chainId], "Branch tree event is not new");
        _lastBlockNumbers[chainId] = blockNumber;

        return (shieldedTreeRoot, wormholeTreeRoot);
    }

    // TODO: Verify and extract master tree event log from master chain
    function _verifyMasterTreeEvent(bytes calldata proof) internal view returns (bytes32 masterShieldedRoot, bytes32 masterWormholeRoot) {
        // TODO: Implement
        (
            uint32 chainId,
            address emittingContract,
            bytes memory topics,
        ) = crossL2Prover.validateEvent(proof);
        require(chainId == 1, "Invalid chain id");
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
        bytes32 shieldedTreeRoot = topicsArray[1];
        bytes32 wormholeTreeRoot = topicsArray[2];
        return (shieldedTreeRoot, wormholeTreeRoot);
    }

    function _insertMasterTrees(uint256 branchShieldedRoot, uint256 branchWormholeRoot) internal returns (uint256 masterShieldedRoot, uint256 masterWormholeRoot) {
        // Insert branch shielded root into master shielded tree
        if (_isMerkleTreeFull(_masterShieldedTrees[currentShieldedTreeId])) {
            currentShieldedTreeId++;
            _initializeMerkleTree(_masterShieldedTrees[currentShieldedTreeId]);
        }
        masterShieldedRoot = _masterShieldedTrees[currentShieldedTreeId].insert(branchShieldedRoot);
        isMasterShieldedRoot[bytes32(masterShieldedRoot)] = true;

        // Insert branch wormhole root into master wormhole tree
        if (_isMerkleTreeFull(_masterWormholeTrees[currentWormholeTreeId])) {
            currentWormholeTreeId++;
            _initializeMerkleTree(_masterWormholeTrees[currentWormholeTreeId]);
        }
        masterWormholeRoot = _masterWormholeTrees[currentWormholeTreeId].insert(branchWormholeRoot);
        isMasterWormholeRoot[bytes32(masterWormholeRoot)] = true;
    }

    function shieldedTransfer(ShieldedTx memory shieldedTx, bytes calldata proof) external {
        bytes32 messageHash = _hashTypedData(shieldedTx);
        
        // Validate roots
        require(isMasterWormholeRoot[shieldedTx.wormholeRoot], "ShieldedPool: wormhole root is not valid");
        require(isMasterShieldedRoot[shieldedTx.shieldedRoot], "ShieldedPool: shielded root is not valid");

        // Validate nullifiers
        require(!wormholeNullifierUsed[shieldedTx.wormholeNullifier], "ShieldedPool: wormhole nullifier is already used");
        for (uint256 i = 0; i < shieldedTx.nullifiers.length; i++) {
            require(!nullifierUsed[shieldedTx.nullifiers[i]], "ShieldedPool: nullifier is already used");
        }

        // Get verifier
        IVerifier verifier = _utxoVerifiers[shieldedTx.nullifiers.length][shieldedTx.commitments.length + shieldedTx.withdrawals.length];
        require(address(verifier) != address(0), "ShieldedPool: verifier is not registered");

        // Get public inputs
        bytes32[] memory inputs = _formatPublicInputs(shieldedTx, messageHash);

        // Verify proof
        require(verifier.verify(proof, inputs), "ShieldedPool: proof is not valid");

        // Mark nullifiers as used
        wormholeNullifierUsed[shieldedTx.wormholeNullifier] = true;
        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            nullifierUsed[shieldedTx.nullifiers[i]] = true;
        }

        // Insert new commitments into shielded tree
        if (_isMerkleTreeSizeOverflow(_branchShieldedTrees[currentShieldedTreeId], shieldedTx.commitments.length)) {
            currentShieldedTreeId++;
            _initializeMerkleTree(_branchShieldedTrees[currentShieldedTreeId]);
        }
        uint256 startIndex = _branchShieldedTrees[currentShieldedTreeId].size;
        uint256 root = _branchShieldedTrees[currentShieldedTreeId].insertMany(shieldedTx.commitments);

        // If withdrawals are present, mint new shares for each withdrawal
        for (uint256 i; i < shieldedTx.withdrawals.length; i++) {
            Withdrawal memory withdrawal = shieldedTx.withdrawals[i];
            IWormhole(withdrawal.asset).unshield(withdrawal.to, withdrawal.id, withdrawal.amount);
        }

        emit WormholeNullifier(shieldedTx.wormholeNullifier);
        emit ShieldedTransfer(currentShieldedTreeId, startIndex, shieldedTx.commitments, shieldedTx.nullifiers, shieldedTx.withdrawals);

        if (block.chainid == 1) {
            // Insert branch shielded root into master shielded tree
            if (_isMerkleTreeFull(_masterShieldedTrees[currentShieldedTreeId])) {
                currentShieldedTreeId++;
                _initializeMerkleTree(_masterShieldedTrees[currentShieldedTreeId]);
            }
            uint256 newMasterShieldedRoot = _masterShieldedTrees[currentShieldedTreeId].insert(root);
            isMasterShieldedRoot[bytes32(newMasterShieldedRoot)] = true;
            emit MasterTreesUpdated(newMasterShieldedRoot, _masterWormholeTrees[currentWormholeTreeId].root(), block.number, block.timestamp);
        } else {
            emit BranchTreesUpdated(currentShieldedTreeId, currentWormholeTreeId, root, _branchWormholeTrees[currentWormholeTreeId].root(), block.number, block.timestamp);
        }
    }

    function ragequit(RagequitTx calldata ragequitTx, bytes calldata proof) external {
        require(isMasterWormholeRoot[ragequitTx.wormholeRoot], "ShieldedPool: wormhole root is not valid");
        require(!wormholeNullifierUsed[ragequitTx.wormholeNullifier], "ShieldedPool: wormhole nullifier is already used");

        TransferMetadata memory entry = _wormholeEntries[ragequitTx.entryId];

        // get wormhole commitment
        bytes32 assetId = _getAssetId(entry.asset, entry.id);
        uint256 commitment = _getWormholeCommitment(ragequitTx.entryId, ragequitTx.approved, entry.from, entry.to, assetId, entry.amount);

        bytes32[] memory inputs = new bytes32[](4);
        inputs[0] = ragequitTx.wormholeRoot;
        inputs[1] = bytes32(commitment);
        inputs[2] = ragequitTx.wormholeNullifier;
        inputs[3] = bytes32(uint256(uint160(entry.from)));

        // verify proof
        require(ragequitVerifier.verify(proof, inputs), "ShieldedPool: proof is not valid");

        // mark wormhole nullifier as used
        wormholeNullifierUsed[ragequitTx.wormholeNullifier] = true;
        emit WormholeNullifier(ragequitTx.wormholeNullifier);

        // return asset amount back to sender
        IWormhole(entry.asset).unshield(entry.from, entry.id, entry.amount);
        emit Ragequit(ragequitTx.entryId, msg.sender, entry.from, entry.asset, entry.id, entry.amount);
    }

    function _formatPublicInputs(ShieldedTx memory shieldedTx, bytes32 messageHash) internal view returns (bytes32[] memory inputs) {
        // Split 256-bit message hash into two 128-bit halves (matches circuit output)
        uint256 hashUint = uint256(messageHash);
        bytes32 messageHashHi = bytes32(hashUint >> 128);
        bytes32 messageHashLo = bytes32(hashUint & type(uint128).max);

        // Public inputs ordering: pub params first, then return values
        // Pub params: chain_id, shielded_root, wormhole_root
        // Return values: hashed_message_hi, hashed_message_lo, wormhole_nullifier, nullifiers[], commitments[]
        uint256 offset = 5 + shieldedTx.nullifiers.length;
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
            Withdrawal memory withdrawal = shieldedTx.withdrawals[i];
            uint256 commitment = _getCommitment(
                uint256(uint160(withdrawal.to)), 
                _getAssetId(withdrawal.asset, withdrawal.id), 
                withdrawal.amount, 
                2 // Transfer Type: WITHDRAWAL
            );
            inputs[offset + shieldedTx.commitments.length + i] = bytes32(commitment);
        }
    }

    function _getCommitment(uint256 recipientHash, bytes32 assetId, uint256 amount, uint256 transferType) internal view returns (uint256) {
        return poseidon2.hash_4(recipientHash, uint256(assetId), amount, uint256(transferType));
    }

    function _getAssetId(address asset, uint256 id) internal view returns (bytes32) {
        return bytes32(poseidon2.hash_2(uint256(uint160(asset)), id));
    }

    function requestWormholeEntry(address from, address to, uint256 id, uint256 amount) external returns (uint256 index) {
        // Every wormhole asset is a token (ERC20/ERC721/ERC1155/etc.)
        index = totalWormholeEntries;
        _wormholeEntries[index] = TransferMetadata({
            from: from,
            to: to,
            asset: msg.sender,
            id: id,
            amount: amount
        });
        unchecked {
            totalWormholeEntries++;
        }
        emit WormholeEntry(index, msg.sender, from, to, id, amount);
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
                    shieldedTx.withdrawals[i].amount
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