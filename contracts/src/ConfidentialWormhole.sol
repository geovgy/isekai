// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IShieldedPool} from "./interfaces/IShieldedPool.sol";
import {Wormhole} from "./Wormhole.sol";
import {LeanIMT, LeanIMTData} from "./libraries/LeanIMT.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

abstract contract ConfidentialWormhole is Wormhole {
    using LeanIMT for LeanIMTData;

    IPoseidon2 public immutable poseidon2;
    IVerifier public immutable confidentialVerifier;

    uint8 public constant CONFIDENTIAL_TREE_DEPTH = 20;

    uint256 public currentConfidentialTreeId;

    mapping(uint256 treeId => LeanIMTData) internal _confidentialTrees;

    mapping(bytes32 root => bool) public isConfidentialRoot;

    mapping(bytes32 nullifier => bool) public nullifierUsed;

    event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed root, bytes32[] nullifiers, uint256[] commitments);

    constructor(
        IShieldedPool shieldedPool_,
        IPoseidon2 poseidon2_,
        IVerifier confidentialVerifier_
    ) Wormhole(shieldedPool_) {
        poseidon2 = poseidon2_;
        confidentialVerifier = confidentialVerifier_;
        _confidentialTrees[currentConfidentialTreeId].init(address(poseidon2));
    }

    function confidentialTransfer(
        address to,
        bytes32 root,
        bytes32[] memory nullifiers,
        bytes32[] memory confidentialContexts,
        bytes calldata proof
    ) virtual external {
        require(isConfidentialRoot[root], "ConfidentialWormhole: root is not valid");
        bytes32[] memory inputs = _formatPublicInputs(root, msg.sender, to, nullifiers, confidentialContexts);
        require(confidentialVerifier.verify(proof, inputs), "ConfidentialWormhole: proof is not valid");
        for (uint256 i = 0; i < nullifiers.length; i++) {
            require(!nullifierUsed[nullifiers[i]], "ConfidentialWormhole: nullifier is already used");
            nullifierUsed[nullifiers[i]] = true;
        }
        if (_isMerkleTreeSizeOverflow(confidentialContexts.length)) {
            currentConfidentialTreeId++;
            _confidentialTrees[currentConfidentialTreeId].init(address(poseidon2));
        }
        uint256[] memory commitments = new uint256[](confidentialContexts.length);
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            commitments[i] = _toConfidentialCommitment(currentConfidentialTreeId, msg.sender, to, 0, 0, confidentialContexts[i]);
        }
        uint256 newRoot = _confidentialTrees[currentConfidentialTreeId].insertMany(commitments);
        isConfidentialRoot[bytes32(newRoot)] = true;
        emit ConfidentialTransfer(msg.sender, to, bytes32(newRoot), nullifiers, commitments);
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            _requestWormholeEntry(msg.sender, to, 0, 0, confidentialContexts[i]);
        }
    }

    function convertToConfidential(
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext
    ) external {
        _convertToConfidential(msg.sender, to, id, amount, confidentialContext);
        // request the wormhole entry
        _requestWormholeEntry(msg.sender, to, id, amount, confidentialContext);
    }

    function _toConfidentialCommitment(
        uint256 treeId,
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext
    ) internal view returns (uint256) {
        uint256 fullContext = uint256(confidentialContext);
        if (amount != 0) {
            fullContext = poseidon2.hash_4(uint160(address(this)), id, amount, fullContext);
        }
        return poseidon2.hash_4(uint256(uint160(from)), uint256(uint160(to)), treeId, fullContext);
    }

    // Override this function to convert the transfer to confidential
    function _convertToConfidential(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext
    ) internal virtual {
        require(confidentialContext != bytes32(0), "ConfidentialWormhole: confidential context is zero");
        if (_isMerkleTreeSizeOverflow(1)) {
            currentConfidentialTreeId++;
            _confidentialTrees[currentConfidentialTreeId].init(address(poseidon2));
        }
        uint256 commitment = _toConfidentialCommitment(currentConfidentialTreeId, from, to, id, amount, confidentialContext);
        uint256 newRoot = _confidentialTrees[currentConfidentialTreeId].insert(commitment);
        isConfidentialRoot[bytes32(newRoot)] = true;
    }

    function convertFromConfidential(
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext,
        bytes32 root,
        bytes32[] memory nullifiers,
        bytes32[] memory confidentialContexts,
        bytes calldata proof
    ) external {
        _convertFromConfidential(msg.sender, to, id, amount, confidentialContext, root, nullifiers, confidentialContexts, proof);
        // request the wormhole entry
        _requestWormholeEntry(msg.sender, to, id, amount, confidentialContext);
    }

    // Override this function to convert the transfer from confidential
    function _convertFromConfidential(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext,
        bytes32 root,
        bytes32[] memory nullifiers,
        bytes32[] memory confidentialContexts,
        bytes calldata proof
    ) internal virtual {
        require(isConfidentialRoot[root], "ConfidentialWormhole: root is not valid");
        bytes32[] memory inputs = _formatPublicInputs(root, from, to, nullifiers, confidentialContexts);
        require(confidentialVerifier.verify(proof, inputs), "ConfidentialWormhole: proof is not valid");
        for (uint256 i = 0; i < nullifiers.length; i++) {
            require(!nullifierUsed[nullifiers[i]], "ConfidentialWormhole: nullifier is already used");
            nullifierUsed[nullifiers[i]] = true;
        }
        if (_isMerkleTreeSizeOverflow(confidentialContexts.length)) {
            currentConfidentialTreeId++;
            _confidentialTrees[currentConfidentialTreeId].init(address(poseidon2));
        }
        uint256[] memory commitments = new uint256[](confidentialContexts.length);
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            commitments[i] = _toConfidentialCommitment(currentConfidentialTreeId, from, to, 0, 0, confidentialContexts[i]);
        }
        uint256 newRoot = _confidentialTrees[currentConfidentialTreeId].insertMany(commitments);
        isConfidentialRoot[bytes32(newRoot)] = true;
        emit ConfidentialTransfer(from, to, bytes32(newRoot), nullifiers, commitments);
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            _requestWormholeEntry(from, to, 0, 0, confidentialContexts[i]);
        }
        if (confidentialContext != bytes32(0)) {
            _convertToConfidential(from, to, id, amount, confidentialContext);
        }
    }

    function _formatPublicInputs(
        bytes32 root,
        address from,
        address to,
        bytes32[] memory nullifiers,
        bytes32[] memory confidentialContexts
    ) internal virtual view returns (bytes32[] memory) {
        bytes32[] memory inputs = new bytes32[](4 + nullifiers.length + confidentialContexts.length);
        inputs[0] = root;
        inputs[1] = bytes32(uint256(uint160(from)));
        inputs[2] = bytes32(uint256(uint160(to)));
        inputs[3] = bytes32(uint256(uint160(address(this))));
        for (uint256 i = 0; i < nullifiers.length; i++) {
            inputs[4 + i] = nullifiers[i];
        }
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            inputs[4 + nullifiers.length + i] = confidentialContexts[i];
        }
        return inputs;
    }

    function _isMerkleTreeSizeOverflow(uint256 batchSize) internal virtual view returns (bool) {
        return _confidentialTrees[currentConfidentialTreeId].size + batchSize > 2 ** CONFIDENTIAL_TREE_DEPTH;
    }
}