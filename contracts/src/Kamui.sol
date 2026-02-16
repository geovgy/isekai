// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {LeanIMT, LeanIMTData} from "./libraries/LeanIMT.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";
import {IKamui} from "./interfaces/IKamui.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract Kamui is IKamui, EIP712, Ownable {
    using LeanIMT for LeanIMTData;

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

    uint8 public constant MERKLE_TREE_DEPTH = 20;

    bytes32 public constant WITHDRAWAL_TYPEHASH = keccak256("Withdrawal(address to,address asset,uint256 id,uint256 amount)");
    bytes32 public constant SHIELDED_TX_TYPEHASH = keccak256("ShieldedTx(uint64 chainId,bytes32 wormholeRoot,bytes32 wormholeNullifier,bytes32 shieldedRoot,bytes32[] nullifiers,uint256[] commitments,Withdrawal[] withdrawals)Withdrawal(address to,address asset,uint256 id,uint256 amount)");

    IPoseidon2 public immutable poseidon2;
    IVerifier public immutable ragequitVerifier;

    uint256 public currentShieldedTreeId;
    uint256 public currentWormholeTreeId;

    uint256 public totalWormholeEntries;
    uint256 public totalWormholeCommitments;

    mapping(address approver => bool) internal _isWormholeApprover;

    mapping(uint256 entryId => bool) internal _wormholeEntriesCommitted;
    mapping(uint256 entryId => TransferMetadata) internal _wormholeEntries;

    mapping(bytes32 nullifier => bool) public wormholeNullifierUsed;
    mapping(bytes32 nullifier => bool) public nullifierUsed;

    mapping(bytes32 root => bool) public isWormholeRoot;
    mapping(bytes32 root => bool) public isShieldedRoot;

    mapping(uint256 inputs => mapping(uint256 outputs => IVerifier)) internal _utxoVerifiers;
    
    mapping(uint256 treeId => LeanIMTData) internal _shieldedTrees;
    mapping(uint256 treeId => LeanIMTData) internal _wormholeTrees;

    event WormholeEntry(uint256 indexed entryId, address indexed token, address indexed from, address to, uint256 id, uint256 amount);
    event WormholeCommitment(uint256 indexed entryId, uint256 indexed commitment, uint256 treeId, uint256 leafIndex, bytes32 assetId, address from, address to, uint256 amount, bool approved);
    event WormholeNullifier(bytes32 indexed nullifier);

    event ShieldedTransfer(uint256 indexed treeId, uint256 startIndex, uint256[] commitments, bytes32[] nullifiers, Withdrawal[] withdrawals);

    event Ragequit(uint256 indexed entryId, address indexed quitter, address indexed returnedTo, address asset, uint256 id, uint256 amount);

    event VerifierAdded(address verifier, uint256 inputs, uint256 outputs);
    event WormholeApproverSet(address indexed approver, bool isApprover);

    constructor(IPoseidon2 poseidon2_, IVerifier ragequitVerifier_, address governor_) EIP712("Kamui", "1") Ownable(governor_) {
        poseidon2 = poseidon2_;
        uint256 shieldedRoot = _initializeMerkleTree(_shieldedTrees[currentShieldedTreeId]);
        uint256 wormholeRoot = _initializeMerkleTree(_wormholeTrees[currentWormholeTreeId]);
        isShieldedRoot[bytes32(shieldedRoot)] = true;
        isWormholeRoot[bytes32(wormholeRoot)] = true;
        ragequitVerifier = ragequitVerifier_;
    }

    function wormholeTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_wormholeTrees[treeId].root()), _wormholeTrees[treeId].size, _wormholeTrees[treeId].depth);
    }

    function shieldedTree(uint256 treeId) external view returns (bytes32 root, uint256 size, uint256 depth) {
        return (bytes32(_shieldedTrees[treeId].root()), _shieldedTrees[treeId].size, _shieldedTrees[treeId].depth);
    }

    function wormholeEntry(uint256 entryId) external view returns (TransferMetadata memory) {
        return _wormholeEntries[entryId];
    }

    // Owner functions
    function addVerifier(IVerifier verifier, uint256 inputs, uint256 outputs) external onlyOwner {
        require(address(verifier) != address(0), "Kamui: verifier is zero address");
        // address existing = address(_utxoVerifiers[inputs][outputs]);
        // require(existing == address(0), "Kamui: verifier already exists");
        require(inputs > 0 && outputs > 0, "Kamui: invalid inputs or outputs");
        _utxoVerifiers[inputs][outputs] = verifier;
        emit VerifierAdded(address(verifier), inputs, outputs);
    }

    function setWormholeApprover(address approver, bool isApprover) external onlyOwner {
        _isWormholeApprover[approver] = isApprover;
        emit WormholeApproverSet(approver, isApprover);
    }

    function _getWormholeCommitment(address from, address to, bytes32 assetId, uint256 amount, bool approved) internal view returns (uint256) {
        return poseidon2.hash_5(approved ? 1 : 0, uint256(uint160(from)), uint256(uint160(to)), uint256(assetId), amount);
    }

    function appendWormholeLeaf(uint256 entryId, bool approved) external {
        require(_isWormholeApprover[msg.sender], "Kamui: caller is not a wormhole approver");
        _appendWormholeLeaf(entryId, approved, false);
    }

    // Appends leaf as rejected entry to wormhole tree
    // Original sender can auto-reject their own entry to expedite ragequitting
    function initiateRagequit(uint256 entryId) external {
        _appendWormholeLeaf(entryId, false, true);
    }

    function _appendWormholeLeaf(uint256 entryId, bool approved, bool isRagequit) internal {
        require(entryId < totalWormholeEntries, "Kamui: entry id does not exist");
        require(!_wormholeEntriesCommitted[entryId], "Kamui: entry is already committed in wormhole tree");
        TransferMetadata memory entry = _wormholeEntries[entryId];
        if (isRagequit) {
            require(entry.from == msg.sender, "Kamui: caller is not the original sender");
            require(!approved, "Kamui: entry cannot be appended as approved");
        }
        bytes32 assetId = _getAssetId(entry.asset, entry.id);
        uint256 commitment = _getWormholeCommitment(entry.from, entry.to, assetId, entry.amount, approved);
        if (_isMerkleTreeFull(_wormholeTrees[currentWormholeTreeId])) {
            currentWormholeTreeId++;
            _initializeMerkleTree(_wormholeTrees[currentWormholeTreeId]);
        }
        uint256 root = _wormholeTrees[currentWormholeTreeId].insert(commitment);
        isWormholeRoot[bytes32(root)] = true;
        _wormholeEntriesCommitted[entryId] = true;
        unchecked {
            totalWormholeCommitments++;
        }
        emit WormholeCommitment(entryId, commitment, currentWormholeTreeId, _wormholeTrees[currentWormholeTreeId].size - 1, assetId, entry.from, entry.to, entry.amount, approved);
    }

    function appendManyWormholeLeaves(WormholePreCommitment[] memory nodes) external {
        require(_isWormholeApprover[msg.sender], "Kamui: caller is not a wormhole approver");
        require(nodes.length > 0 && nodes.length <= (2 ** MERKLE_TREE_DEPTH) / 5, "Kamui: invalid nodes length");
        for (uint256 i = 0; i < nodes.length; i++) {
            require(!_wormholeEntriesCommitted[nodes[i].entryId], "Kamui: entry is already committed in wormhole tree");
            require(nodes[i].entryId < totalWormholeEntries, "Kamui: entry id does not exist");
        }
        if (_isMerkleTreeSizeOverflow(_wormholeTrees[currentWormholeTreeId], nodes.length)) {
            currentWormholeTreeId++;
            _initializeMerkleTree(_wormholeTrees[currentWormholeTreeId]);
        }
        uint256[] memory commitments = new uint256[](nodes.length);
        uint256 startLeafIndex = _wormholeTrees[currentWormholeTreeId].size;
        for (uint256 i = 0; i < nodes.length; i++) {
            TransferMetadata memory entry = _wormholeEntries[nodes[i].entryId];
            bytes32 assetId = _getAssetId(entry.asset, entry.id);
            commitments[i] = _getWormholeCommitment(entry.from, entry.to, assetId, entry.amount, nodes[i].approved);
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
        uint256 root = _wormholeTrees[currentWormholeTreeId].insertMany(commitments);
        isWormholeRoot[bytes32(root)] = true;
        unchecked {
            totalWormholeCommitments += nodes.length;
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

    function shieldedTransfer(ShieldedTx memory shieldedTx, bytes calldata proof) external {
        bytes32 messageHash = _hashTypedData(shieldedTx);
        
        // Validate roots
        require(isWormholeRoot[shieldedTx.wormholeRoot], "Kamui: wormhole root is not valid");
        require(isShieldedRoot[shieldedTx.shieldedRoot], "Kamui: shielded root is not valid");

        // Validate nullifiers
        require(!wormholeNullifierUsed[shieldedTx.wormholeNullifier], "Kamui: wormhole nullifier is already used");
        for (uint256 i = 0; i < shieldedTx.nullifiers.length; i++) {
            require(!nullifierUsed[shieldedTx.nullifiers[i]], "Kamui: nullifier is already used");
        }

        // Get verifier
        IVerifier verifier = _utxoVerifiers[shieldedTx.nullifiers.length][shieldedTx.commitments.length + shieldedTx.withdrawals.length];
        require(address(verifier) != address(0), "Kamui: verifier is not registered");

        // Get public inputs
        bytes32[] memory inputs = _formatPublicInputs(shieldedTx, messageHash);

        // Verify proof
        require(verifier.verify(proof, inputs), "Kamui: proof is not valid");

        // Mark nullifiers as used
        wormholeNullifierUsed[shieldedTx.wormholeNullifier] = true;
        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            nullifierUsed[shieldedTx.nullifiers[i]] = true;
        }

        // Insert new commitments into shielded tree
        if (_isMerkleTreeSizeOverflow(_shieldedTrees[currentShieldedTreeId], shieldedTx.commitments.length)) {
            currentShieldedTreeId++;
            _initializeMerkleTree(_shieldedTrees[currentShieldedTreeId]);
        }
        uint256 startIndex = _shieldedTrees[currentShieldedTreeId].size;
        uint256 root = _shieldedTrees[currentShieldedTreeId].insertMany(shieldedTx.commitments);
        isShieldedRoot[bytes32(root)] = true;

        // If withdrawals are present, mint new shares for each withdrawal
        for (uint256 i; i < shieldedTx.withdrawals.length; i++) {
            Withdrawal memory withdrawal = shieldedTx.withdrawals[i];
            IWormhole(withdrawal.asset).unshield(withdrawal.to, withdrawal.id, withdrawal.amount);
        }

        emit WormholeNullifier(shieldedTx.wormholeNullifier);
        emit ShieldedTransfer(currentShieldedTreeId, startIndex, shieldedTx.commitments, shieldedTx.nullifiers, shieldedTx.withdrawals);
    }

    function ragequit(RagequitTx calldata ragequitTx, bytes calldata proof) external {
        require(isWormholeRoot[ragequitTx.wormholeRoot], "Kamui: wormhole root is not valid");
        require(!wormholeNullifierUsed[ragequitTx.wormholeNullifier], "Kamui: wormhole nullifier is already used");

        TransferMetadata memory entry = _wormholeEntries[ragequitTx.entryId];

        // get wormhole commitment
        bytes32 assetId = _getAssetId(entry.asset, entry.id);
        uint256 commitment = _getWormholeCommitment(entry.from, entry.to, assetId, entry.amount, ragequitTx.approved);

        bytes32[] memory inputs = new bytes32[](4);
        inputs[0] = ragequitTx.wormholeRoot;
        inputs[1] = bytes32(commitment);
        inputs[2] = ragequitTx.wormholeNullifier;
        inputs[3] = bytes32(bytes20(entry.from));

        // verify proof
        require(ragequitVerifier.verify(proof, inputs), "Kamui: proof is not valid");

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
        // Pub params: shielded_root, wormhole_root
        // Return values: hashed_message_hi, hashed_message_lo, wormhole_nullifier, nullifiers[], commitments[]
        uint256 offset = 5 + shieldedTx.nullifiers.length;
        inputs = new bytes32[](offset + shieldedTx.commitments.length + shieldedTx.withdrawals.length);
        inputs[0] = shieldedTx.shieldedRoot;
        inputs[1] = shieldedTx.wormholeRoot;
        inputs[2] = messageHashHi;
        inputs[3] = messageHashLo;
        inputs[4] = shieldedTx.wormholeNullifier;
        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            inputs[5 + i] = shieldedTx.nullifiers[i];
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