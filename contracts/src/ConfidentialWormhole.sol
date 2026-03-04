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

    enum ConfidentialConversionType {
        DEPOSIT,
        WITHDRAWAL
    }

    event ConfidentialTransfer(address indexed from, address indexed to, uint256 indexed treeId, bytes32 root, bytes32[] nullifiers, bytes32[] confidentialContexts);
    event ConfidentialConversion(address indexed from, address indexed to, uint256 indexed treeId, bytes32 root, uint256 id, uint256 amount, bytes32 confidentialContext, ConfidentialConversionType conversionType);

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
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            _requestWormholeEntry(msg.sender, to, 0, 0, confidentialContexts[i]);
        }
        emit ConfidentialTransfer(msg.sender, to, currentConfidentialTreeId, bytes32(newRoot), nullifiers, confidentialContexts);
    }

    function convertToConfidential(
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext
    ) external {
        _convertToConfidential(msg.sender, to, id, amount, confidentialContext);
        _updateOnConfidentialConversion(msg.sender, to, id, amount, confidentialContext, ConfidentialConversionType.DEPOSIT);
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
        _convertFromConfidential(msg.sender, to, root, nullifiers, confidentialContexts, proof);
        _updateOnConfidentialConversion(msg.sender, to, id, amount, confidentialContext, ConfidentialConversionType.WITHDRAWAL);
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

    function _updateOnConfidentialConversion(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext,
        ConfidentialConversionType conversionType
    ) internal virtual {
        uint256 treeId = currentConfidentialTreeId;
        uint256 root = _confidentialTrees[treeId].root();
        emit ConfidentialConversion(from, to, treeId, bytes32(root), id, amount, confidentialContext, conversionType);
        _requestWormholeEntry(from, to, id, amount, confidentialContext);
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

    // Override this function to convert the transfer from confidential
    function _convertFromConfidential(
        address from,
        address to,
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
        emit ConfidentialTransfer(from, to, currentConfidentialTreeId, bytes32(newRoot), nullifiers, confidentialContexts);
        for (uint256 i = 0; i < confidentialContexts.length; i++) {
            _requestWormholeEntry(from, to, 0, 0, confidentialContexts[i]);
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