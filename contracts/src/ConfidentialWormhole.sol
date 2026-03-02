// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IShieldedPool} from "./interfaces/IShieldedPool.sol";
import {Wormhole} from "./Wormhole.sol";
import {LeanIMT, LeanIMTData} from "./libraries/LeanIMT.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

abstract contract ConfidentialWormhole is Wormhole {
    using LeanIMT for LeanIMTData;

    bytes32 private constant CONFIDENTIAL_TRANSFER_TYPEHASH = keccak256("ConfidentialTransfer(address from,address to,bytes32[] nullifiers,bytes32[] commitments)");

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
        uint256[] memory commitments,
        bytes calldata proof
    ) virtual external {
        require(isConfidentialRoot[root], "ConfidentialWormhole: root is not valid");
        bytes32[] memory inputs = _formatPublicInputs(msg.sender, to, nullifiers, commitments);
        require(confidentialVerifier.verify(proof, inputs), "ConfidentialWormhole: proof is not valid");
        for (uint256 i = 0; i < nullifiers.length; i++) {
            require(!nullifierUsed[nullifiers[i]], "ConfidentialWormhole: nullifier is already used");
            nullifierUsed[nullifiers[i]] = true;
        }
        if (_isMerkleTreeSizeOverflow(commitments.length)) {
            currentConfidentialTreeId++;
            _confidentialTrees[currentConfidentialTreeId].init(address(poseidon2));
        }
        uint256 newRoot = _confidentialTrees[currentConfidentialTreeId].insertMany(commitments);
        isConfidentialRoot[bytes32(newRoot)] = true;
        emit ConfidentialTransfer(msg.sender, to, bytes32(newRoot), nullifiers, commitments);
        for (uint256 i = 0; i < commitments.length; i++) {
            _requestWormholeEntry(msg.sender, to, 0, 0, bytes32(commitments[i]));
        }
    }

    function convertToConfidential(
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext
    ) external {
        _convertToConfidential(msg.sender, to, id, amount, confidentialContext);
    }

    // Override this function to convert the transfer to confidential
    function _convertToConfidential(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext
    ) internal virtual {
        _requestWormholeEntry(from, to, id, amount, confidentialContext);
    }

    function convertFromConfidential(
        address to,
        uint256 id,
        uint256 amount,
        bytes32 confidentialContext,
        bytes32 root,
        bytes32[] memory nullifiers,
        uint256[] memory commitments,
        bytes calldata proof
    ) external {
        _convertFromConfidential(msg.sender, to, id, amount, confidentialContext, root, nullifiers, commitments, proof);
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
        uint256[] memory commitments,
        bytes calldata proof
    ) internal virtual {
        require(isConfidentialRoot[root], "ConfidentialWormhole: root is not valid");
        bytes32[] memory inputs = _formatPublicInputs(from, to, nullifiers, commitments);
        require(confidentialVerifier.verify(proof, inputs), "ConfidentialWormhole: proof is not valid");
        for (uint256 i = 0; i < nullifiers.length; i++) {
            require(!nullifierUsed[nullifiers[i]], "ConfidentialWormhole: nullifier is already used");
            nullifierUsed[nullifiers[i]] = true;
        }
        if (_isMerkleTreeSizeOverflow(commitments.length)) {
            currentConfidentialTreeId++;
            _confidentialTrees[currentConfidentialTreeId].init(address(poseidon2));
        }
        uint256 newRoot = _confidentialTrees[currentConfidentialTreeId].insertMany(commitments);
        isConfidentialRoot[bytes32(newRoot)] = true;
        emit ConfidentialTransfer(from, to, bytes32(newRoot), nullifiers, commitments);
        for (uint256 i = 0; i < commitments.length; i++) {
            _requestWormholeEntry(from, to, 0, 0, bytes32(commitments[i]));
        }
        _requestWormholeEntry(from, to, id, amount, confidentialContext);
    }

    function _formatPublicInputs(
        address from,
        address to,
        bytes32[] memory nullifiers,
        uint256[] memory commitments
    ) internal virtual pure returns (bytes32[] memory) {
        bytes32[] memory inputs = new bytes32[](2 + nullifiers.length + commitments.length);
        inputs[0] = bytes20(from);
        inputs[1] = bytes20(to);
        for (uint256 i = 0; i < nullifiers.length; i++) {
            inputs[2 + i] = nullifiers[i];
        }
        for (uint256 i = 0; i < commitments.length; i++) {
            inputs[2 + nullifiers.length + i] = bytes32(commitments[i]);
        }
        return inputs;
    }

    function _isMerkleTreeSizeOverflow(uint256 batchSize) internal virtual view returns (bool) {
        return _confidentialTrees[currentConfidentialTreeId].size + batchSize > 2 ** CONFIDENTIAL_TREE_DEPTH;
    }
}