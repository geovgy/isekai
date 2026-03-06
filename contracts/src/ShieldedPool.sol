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
        bytes32 confidentialContext;
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

    uint64 public constant MASTER_CHAIN_ID = 11155111;

    IPoseidon2 public immutable poseidon2;
    IVerifier public immutable ragequitVerifier;
    ICrossL2ProverV2 public immutable crossL2Prover;

    mapping(uint256 chainId => mapping(address branch => bool)) public isBranch;

    uint256 public currentWormholeTreeId;
    uint256 public currentMasterShieldedTreeId;
    uint256 public currentMasterWormholeTreeId;

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
    
    mapping(uint256 treeId => LeanIMTData) internal _branchWormholeTrees; // chain-specific whose root appends to master wormhole tree

    mapping(uint64 chainId => uint256 lastBlockNumber) internal _lastBlockNumbers;

    // TODO: implement rollback tree in shieldedTransfer function and public inputs
    IndexedMerkleTree public rollbackTree;
    mapping(uint64 chainId => uint256 index) internal _currentBranchIndices;
    mapping(uint64 chainId => mapping(uint256 index => BranchInfo)) internal _branchInfos; // for tracking possible chain rollbacks

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

    constructor(IPoseidon2 poseidon2_, IVerifier ragequitVerifier_, ICrossL2ProverV2 crossL2Prover_, address governor_) EIP712("ShieldedPool", "1") Ownable(governor_) {
        poseidon2 = poseidon2_;
        _initializeMerkleTree(_branchWormholeTrees[currentWormholeTreeId]);
        uint256 shieldedRoot = _initializeMerkleTree(_masterShieldedTrees[currentMasterShieldedTreeId]);
        uint256 wormholeRoot = _initializeMerkleTree(_masterWormholeTrees[currentMasterWormholeTreeId]);
        isMasterShieldedRoot[bytes32(shieldedRoot)] = true;
        isMasterWormholeRoot[bytes32(wormholeRoot)] = true;
        ragequitVerifier = ragequitVerifier_;
        crossL2Prover = crossL2Prover_;

        rollbackTree.init(address(poseidon2), ROLLBACK_TREE_DEPTH);
    }

    modifier onlyBranch(uint256 chainId) {
        require(isBranch[chainId][msg.sender], "ShieldedPool: caller is not a branch");
        _;
    }

    function markShieldedNullifierUsed(bytes32 nullifier) external onlyBranch(block.chainid) {
        require(!nullifierUsed[nullifier], "ShieldedPool: nullifier is already used");
        nullifierUsed[nullifier] = true;
    }

    function markWormholeNullifierUsed(bytes32 nullifier) external onlyBranch(block.chainid) {
        require(!wormholeNullifierUsed[nullifier], "ShieldedPool: wormhole nullifier is already used");
        wormholeNullifierUsed[nullifier] = true;
        emit WormholeNullifier(nullifier);
    }

    function unshield(Withdrawal[] calldata withdrawals) external onlyBranch(block.chainid) {
        for (uint256 i; i < withdrawals.length; i++) {
            Withdrawal memory withdrawal = withdrawals[i];
            IWormhole(withdrawal.asset).unshield(withdrawal.to, withdrawal.id, withdrawal.amount, withdrawal.confidentialContext);
        }
    }

    function branchWormholeTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_branchWormholeTrees[treeId].root()), _branchWormholeTrees[treeId].size, _branchWormholeTrees[treeId].depth);
    }

    function masterWormholeTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_masterWormholeTrees[treeId].root()), _masterWormholeTrees[treeId].size, _masterWormholeTrees[treeId].depth);
    }

    function masterShieldedTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_masterShieldedTrees[treeId].root()), _masterShieldedTrees[treeId].size, _masterShieldedTrees[treeId].depth);
    }

    function lastBlockNumber(uint64 chainId) external view returns (uint256) {
        return _lastBlockNumbers[chainId];
    }

    function wormholeEntry(uint256 entryId) external view returns (TransferMetadata memory) {
        return _wormholeEntries[entryId];
    }

    // Owner functions
    function addVerifier(IVerifier verifier, uint256 inputs, uint256 outputs) external onlyOwner {
        require(address(verifier) != address(0), "ShieldedPool: verifier is zero address");
        require(inputs > 0 && outputs > 0, "ShieldedPool: invalid inputs or outputs");
        _utxoVerifiers[inputs][outputs] = verifier;
        emit VerifierAdded(address(verifier), inputs, outputs);
    }

    function addBranch(uint64 chainId, address branch) external onlyOwner {
        require(!isBranch[chainId][branch], "ShieldedPool: branch already exists");
        isBranch[chainId][branch] = true;
        emit BranchAdded(chainId, branch);
    }

    function setWormholeApprover(address approver, bool isApprover) external onlyOwner {
        _isWormholeApprover[approver] = isApprover;
        emit WormholeApproverSet(approver, isApprover);
    }

    function requestWormholeEntry(address from, address to, uint256 id, uint256 amount, bytes32 confidentialContext) external returns (uint256 index) {
        // Every wormhole asset is a token (ERC20/ERC721/ERC1155/etc.)
        index = totalWormholeEntries;
        _wormholeEntries[index] = TransferMetadata({
            from: from,
            to: to,
            asset: msg.sender,
            id: id,
            amount: amount,
            confidentialContext: confidentialContext
        });
        unchecked {
            totalWormholeEntries++;
        }
        emit WormholeEntry(index, msg.sender, from, to, id, amount, confidentialContext);
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
        uint256 commitment = _getWormholeCommitment(entryId, approved, entry.from, entry.to, entry.asset, entry.id, entry.amount, entry.confidentialContext);
        if (_isMerkleTreeFull(_branchWormholeTrees[currentWormholeTreeId])) {
            currentWormholeTreeId++;
            _initializeMerkleTree(_branchWormholeTrees[currentWormholeTreeId]);
        }
        uint256 root = _branchWormholeTrees[currentWormholeTreeId].insert(commitment);
        _wormholeEntriesCommitted[entryId] = true;
        unchecked {
            totalWormholeCommitments++;
        }
        
        emit WormholeCommitment(entryId, commitment, currentWormholeTreeId, _branchWormholeTrees[currentWormholeTreeId].size - 1, entry.asset, entry.id, entry.from, entry.to, entry.amount, approved);
        // emit BranchTreesUpdated(currentShieldedTreeId, currentWormholeTreeId, _branchShieldedTrees[currentShieldedTreeId].root(), root, block.number, block.timestamp);
        emit WormholeTreeUpdated(currentWormholeTreeId, root, block.number, block.timestamp);

        if (block.chainid == MASTER_CHAIN_ID) {
            // Insert branch wormhole root into master wormhole tree
            uint256 newMasterWormholeRoot = _insertWormholeMasterLeaf(MASTER_CHAIN_ID, root, block.number, block.timestamp);
            emit MasterTreesUpdated(currentMasterShieldedTreeId, currentMasterWormholeTreeId, _masterShieldedTrees[currentMasterShieldedTreeId].root(), newMasterWormholeRoot, block.number, block.timestamp);
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
            commitments[i] = _getWormholeCommitment(nodes[i].entryId, nodes[i].approved, entry.from, entry.to, entry.asset, entry.id, entry.amount, entry.confidentialContext);
            _wormholeEntriesCommitted[nodes[i].entryId] = true;
            emit WormholeCommitment(
                nodes[i].entryId,
                commitments[i],
                currentWormholeTreeId,
                startLeafIndex + i,
                entry.asset,
                entry.id,
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
        
        // emit BranchTreesUpdated(currentShieldedTreeId, currentWormholeTreeId, _branchShieldedTrees[currentShieldedTreeId].root(), root, block.number, block.timestamp);
        emit WormholeTreeUpdated(currentWormholeTreeId, root, block.number, block.timestamp);
        
        if (block.chainid == MASTER_CHAIN_ID) {
            // Insert branch wormhole root into master wormhole tree
            uint256 newMasterWormholeRoot = _insertWormholeMasterLeaf(MASTER_CHAIN_ID, root, block.number, block.timestamp);
            emit MasterTreesUpdated(currentMasterShieldedTreeId, currentMasterWormholeTreeId, _masterShieldedTrees[currentMasterShieldedTreeId].root(), newMasterWormholeRoot, block.number, block.timestamp);
        }
    }

    function ragequit(RagequitTx calldata ragequitTx, bytes calldata proof) external {
        require(isMasterWormholeRoot[ragequitTx.wormholeRoot], "ShieldedPool: wormhole root is not valid");
        require(!wormholeNullifierUsed[ragequitTx.wormholeNullifier], "ShieldedPool: wormhole nullifier is already used");

        TransferMetadata memory entry = _wormholeEntries[ragequitTx.entryId];

        // get wormhole commitment
        uint256 commitment = _getWormholeCommitment(ragequitTx.entryId, ragequitTx.approved, entry.from, entry.to, entry.asset, entry.id, entry.amount, entry.confidentialContext);

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
        IWormhole(entry.asset).unshield(entry.from, entry.id, entry.amount, bytes32(0)); // MUST be public. No confidential context for ragequit
        emit Ragequit(ragequitTx.entryId, msg.sender, entry.from, entry.asset, entry.id, entry.amount);
    }

    function updateMasterTrees(bytes calldata proof) external {
        require(block.chainid != MASTER_CHAIN_ID, "ShieldedPool: cannot update master trees on master chain");
        (uint256 shieldedTreeId, uint256 wormholeTreeId, bytes32 masterShieldedRoot, bytes32 masterWormholeRoot, uint256 blockNumber, uint256 timestamp) = _verifyMasterTreeEvent(proof);
        isMasterShieldedRoot[masterShieldedRoot] = true;
        isMasterWormholeRoot[masterWormholeRoot] = true;
        emit MasterTreesUpdated(shieldedTreeId, wormholeTreeId, uint256(masterShieldedRoot), uint256(masterWormholeRoot), blockNumber, timestamp);
        // if (block.chainid == MASTER_CHAIN_ID) {
        //     (uint64 branchChainId, bytes32 branchShieldedRoot, bytes32 branchWormholeRoot, uint256 branchBlockNumber, uint256 timestamp) = _verifyAndExtractBranchTreeEvent(proof);
        //     (uint256 masterShieldedRoot, uint256 masterWormholeRoot) = _insertMasterTrees(uint256(branchShieldedRoot), uint256(branchWormholeRoot), branchChainId, branchBlockNumber, timestamp);
        //     emit MasterShieldedTreeLeaf(currentMasterShieldedTreeId, uint256(branchShieldedRoot), branchChainId, branchBlockNumber, timestamp);
        //     emit MasterWormholeTreeLeaf(currentMasterWormholeTreeId, uint256(branchWormholeRoot), branchChainId, branchBlockNumber, timestamp);
        //     emit MasterTreesUpdated(currentShieldedTreeId, currentWormholeTreeId, masterShieldedRoot, masterWormholeRoot, block.number, block.timestamp);
        // } else {
        //     (uint256 shieldedTreeId, uint256 wormholeTreeId, bytes32 masterShieldedRoot, bytes32 masterWormholeRoot, uint256 blockNumber, uint256 timestamp) = _verifyMasterTreeEvent(proof);
        //     isMasterShieldedRoot[masterShieldedRoot] = true;
        //     isMasterWormholeRoot[masterWormholeRoot] = true;
        //     // TODO: emit event of received master trees
        //     emit MasterTreesUpdated(shieldedTreeId, wormholeTreeId, uint256(masterShieldedRoot), uint256(masterWormholeRoot), blockNumber, timestamp);
        // }
    }

    function _insertWormholeMasterLeaf(uint256 chainId, uint256 wormholeRoot, uint256 blockNumber, uint256 blockTimestamp) internal returns (uint256 newMasterWormholeRoot) {
        if (_isMerkleTreeFull(_masterWormholeTrees[currentMasterWormholeTreeId])) {
            currentMasterWormholeTreeId++;
            _initializeMerkleTree(_masterWormholeTrees[currentMasterWormholeTreeId]);
        }
        newMasterWormholeRoot = _masterWormholeTrees[currentMasterWormholeTreeId].insert(wormholeRoot);
        isMasterWormholeRoot[bytes32(newMasterWormholeRoot)] = true;
        emit MasterWormholeTreeLeaf(currentMasterWormholeTreeId, wormholeRoot, uint64(chainId), blockNumber, blockTimestamp);
        return newMasterWormholeRoot;
    }

    function _insertShieldedMasterLeaf(uint256 chainId, uint256 shieldedRoot, uint256 blockNumber, uint256 blockTimestamp) internal returns (uint256 newMasterShieldedRoot) {
        if (_isMerkleTreeFull(_masterShieldedTrees[currentMasterShieldedTreeId])) {
            currentMasterShieldedTreeId++;
            _initializeMerkleTree(_masterShieldedTrees[currentMasterShieldedTreeId]);
        }
        newMasterShieldedRoot = _masterShieldedTrees[currentMasterShieldedTreeId].insert(shieldedRoot);
        isMasterShieldedRoot[bytes32(newMasterShieldedRoot)] = true;
        emit MasterShieldedTreeLeaf(currentMasterShieldedTreeId, shieldedRoot, uint64(chainId), blockNumber, blockTimestamp);
        return newMasterShieldedRoot;
    }

    function insertShieldedMasterLeaf(uint256 chainId, uint256 shieldedRoot, uint256 blockNumber, uint256 blockTimestamp) external onlyBranch(chainId) {
        require(block.chainid == MASTER_CHAIN_ID, "ShieldedPool: cannot insert shielded master leaf on branch chain");
        uint256 newMasterShieldedRoot = _insertShieldedMasterLeaf(chainId, shieldedRoot, blockNumber, blockTimestamp);
        emit MasterTreesUpdated(currentMasterShieldedTreeId, currentMasterWormholeTreeId, newMasterShieldedRoot, _masterWormholeTrees[currentMasterWormholeTreeId].root(), block.number, block.timestamp);
    }

    // TODO: Verify and extract master tree event log from master chain
    function _verifyMasterTreeEvent(bytes calldata proof) internal returns (uint256 shieldedTreeId, uint256 wormholeTreeId, bytes32 masterShieldedRoot, bytes32 masterWormholeRoot, uint256 blockNumber, uint256 timestamp) {
        // TODO: Implement
        (
            uint32 chainId,
            address emittingContract,
            bytes memory topics,
            bytes memory unindexedData
        ) = crossL2Prover.validateEvent(proof);
        require(chainId == MASTER_CHAIN_ID && block.chainid != MASTER_CHAIN_ID, "Invalid chain id");
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
        require(topicsArray[0] == MasterTreesUpdated.selector, "Invalid event signature");
        masterShieldedRoot = topicsArray[1];
        masterWormholeRoot = topicsArray[2];

        (shieldedTreeId, wormholeTreeId, blockNumber, timestamp) = abi.decode(unindexedData, (uint256, uint256, uint256, uint256));
        require(blockNumber > _lastBlockNumbers[chainId], "Master tree event is not new");
        _lastBlockNumbers[chainId] = blockNumber;

        return (shieldedTreeId, wormholeTreeId, masterShieldedRoot, masterWormholeRoot, blockNumber, timestamp);
    }

    function _insertMasterTrees(uint256 branchShieldedRoot, uint256 branchWormholeRoot, uint64 branchChainId, uint256 branchBlockNumber, uint256 timestamp) internal returns (uint256 masterShieldedRoot, uint256 masterWormholeRoot) {
        // Insert branch shielded root into master shielded tree (skip zero roots from inactive branch trees)
        if (branchShieldedRoot != 0 && !_masterShieldedTrees[currentMasterShieldedTreeId].has(branchShieldedRoot)) {
            masterShieldedRoot = _insertShieldedMasterLeaf(branchChainId, branchShieldedRoot, branchBlockNumber, timestamp);
        }

        // Insert branch wormhole root into master wormhole tree (skip zero roots from inactive branch trees)
        if (branchWormholeRoot != 0 && !_masterWormholeTrees[currentMasterWormholeTreeId].has(branchWormholeRoot)) {
            masterWormholeRoot = _insertWormholeMasterLeaf(branchChainId, branchWormholeRoot, branchBlockNumber, timestamp);
        }
    }

    function _getCommitment(uint256 recipientHash, uint256 token, uint256 tokenId, uint256 amount, uint256 transferType) internal view returns (uint256) {
        return poseidon2.hash_5(recipientHash, token, tokenId, amount, transferType);
    }

    function _getWormholeCommitment(
        uint256 entryId, 
        bool approved, 
        address from, 
        address to, 
        address token, 
        uint256 tokenId, 
        uint256 amount,
        bytes32 confidentialContext
    ) internal view returns (uint256) {
        uint256 idHash = poseidon2.hash_2(block.chainid, entryId);
        uint256[] memory inputs = new uint256[](8);
        inputs[0] = idHash;
        inputs[1] = approved ? 1 : 0;
        inputs[2] = uint256(uint160(from));
        inputs[3] = uint256(uint160(to));
        inputs[4] = uint256(uint160(token));
        inputs[5] = tokenId;
        inputs[6] = amount;
        inputs[7] = uint256(confidentialContext);
        return poseidon2.hash(inputs);
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
}