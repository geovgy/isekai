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

contract ShieldedPoolDelegateBranch is EIP712, Ownable {
    using LeanIMT for LeanIMTData;
    using IndexedMerkleTreeLib for IndexedMerkleTree;

    struct ShieldedTx {
        uint64 chainId;
        bytes32 wormholeRoot;
        bytes32 wormholeNullifier;
        bytes32 shieldedRoot;
        bytes32 signerRoot;
        bytes32 signerCommitment;
        bytes32 signerNullifier;
        bytes32[] nullifiers;
        uint256[] commitments;
        IShieldedPool.Withdrawal[] withdrawals;
    }

    struct SignerDelegation {
        uint64 chainId;
        address owner;
        address delegate;
        address recipient;
        bool recipientLocked;
        uint64 startTime;
        uint64 endTime;
        address token;
        bool tokenLocked;
        uint256 tokenId;
        uint256 amount;
        uint8 amountType; // 0: exact (enforce tokenId), 1: max (enforce tokenId), 2: min (enforce tokenId), 3: exact (ignore tokenId), 4: max (ignore tokenId), 5: min (ignore tokenId)
        uint64 maxCumulativeAmount;
        uint64 maxNonce;
        uint64 timeInterval;
        uint8 transferType; // 0: transfer, 1: withdrawal
    }

    struct RevokedSignerDelegation {
        bytes32 delegationHash;
        bytes32 signerRoot;
        bytes32 signerCommitment;
        bytes32 signerNullifier;
    }

    uint8 public constant MERKLE_TREE_DEPTH = 20;

    uint256 public constant TIMESTAMP_MARGIN = 1 minutes; // 1 minute margin for timestamp

    bytes32 private constant WITHDRAWAL_TYPEHASH = keccak256("Withdrawal(address to,address asset,uint256 id,uint256 amount,bytes32 confidentialContext)");
    bytes32 private constant SHIELDED_TX_TYPEHASH = keccak256("ShieldedTx(uint64 chainId,bytes32 wormholeRoot,bytes32 wormholeNullifier,bytes32 shieldedRoot,bytes32 signerRoot,bytes32 signerCommitment,bytes32 signerNullifier,bytes32[] nullifiers,uint256[] commitments,Withdrawal[] withdrawals)Withdrawal(address to,address asset,uint256 id,uint256 amount,bytes32 confidentialContext)");
    bytes32 private constant SIGNER_DELEGATION_TYPEHASH = keccak256("SignerDelegation(uint64 chainId,address owner,address delegate,address recipient,bool recipientLocked,uint64 startTime,uint64 endTime,address token,bool tokenLocked,uint256 tokenId,uint256 amount,uint8 amountType,uint64 maxCumulativeAmount,uint64 maxNonce,uint64 timeInterval,uint8 transferType)");
    bytes32 private constant REVOKED_SIGNER_DELEGATION_TYPEHASH = keccak256("RevokedSignerDelegation(bytes32 delegationHash,bytes32 signerRoot,bytes32 signerCommitment,bytes32 signerNullifier)");

    IShieldedPool public immutable masterShieldedPool;
    IPoseidon2 public immutable poseidon2;
    ICrossL2ProverV2 public immutable crossL2Prover;
    IVerifier public immutable delegateRevocationVerifier;
    bytes32 private immutable _eip712DomainHashLo;
    bytes32 private immutable _eip712DomainHashHi;

    uint256 public currentShieldedTreeId;

    // NEW
    uint256 public currentSignerTreeId;

    mapping(bytes32 root => bool) public isSignerRoot;
    mapping(bytes32 nullifier => bool) public signerNullifierUsed;

    mapping(uint256 inputs => mapping(uint256 outputs => IVerifier)) internal _utxoVerifiers;
    mapping(uint256 batchSize => mapping(uint256 inputs => mapping(uint256 outputs => IVerifier))) internal _batchUtxoVerifiers;
    
    mapping(uint256 treeId => LeanIMTData) internal _branchShieldedTrees; // chain-specific whose root appends to master shielded tree

    // NEW
    mapping(uint256 treeId => LeanIMTData) internal _signerTrees;

    mapping(uint64 chainId => uint256 lastBlockNumber) internal _lastBlockNumbers;

    event ShieldedTransfer(uint256 indexed treeId, uint256 startIndex, uint256[] commitments, bytes32[] nullifiers, IShieldedPool.Withdrawal[] withdrawals);

    event ShieldedTransferSigner(
        uint256 indexed treeId,
        uint256 indexed startIndex,
        bytes32 signerCommitment,
        bytes32 signerNullifier
    );

    event ShieldedTreeUpdated(
        uint256 indexed shieldedTreeId,
        uint256 indexed shieldedRoot, 
        uint256 blockNumber,
        uint256 blockTimestamp
    );

    event SignerTreeUpdated(
        uint256 indexed signerTreeId,
        uint256 indexed signerRoot,
        uint256 blockNumber,
        uint256 blockTimestamp
    );

    event VerifierAdded(address verifier, uint256 inputs, uint256 outputs);
    event BatchVerifierAdded(address verifier, uint256 batchSize, uint256 inputs, uint256 outputs);

    constructor(IShieldedPool masterShieldedPool_, IVerifier delegateRevocationVerifier_, address governor_) EIP712("ShieldedPool", "1") Ownable(governor_) {
        masterShieldedPool = masterShieldedPool_;
        poseidon2 = masterShieldedPool_.poseidon2();
        delegateRevocationVerifier = delegateRevocationVerifier_;
        _initializeMerkleTree(_branchShieldedTrees[currentShieldedTreeId]);
        uint256 signerRoot = _initializeMerkleTree(_signerTrees[currentSignerTreeId]);
        isSignerRoot[bytes32(signerRoot)] = true;
        crossL2Prover = masterShieldedPool_.crossL2Prover();

        (bytes32 domainHashHi, bytes32 domainHashLo) = _splitHash(_domainSeparatorV4());
        _eip712DomainHashLo = domainHashLo;
        _eip712DomainHashHi = domainHashHi;
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

    function addBatchVerifier(IVerifier verifier, uint256 batchSize, uint256 inputs, uint256 outputs) external onlyOwner {
        require(address(verifier) != address(0), "ShieldedPool: verifier is zero address");
        require(batchSize > 0 && inputs > 0 && outputs > 0, "ShieldedPool: invalid batch size, inputs or outputs");
        _batchUtxoVerifiers[batchSize][inputs][outputs] = verifier;
        emit BatchVerifierAdded(address(verifier), batchSize, inputs, outputs);
    }

    function revokeSignerDelegation(RevokedSignerDelegation memory revokedSignerDelegation, bytes calldata proof) external {
        bytes32 messageHash = _hashTypedData(revokedSignerDelegation);
        require(isSignerRoot[revokedSignerDelegation.signerRoot], "ShieldedPool: signer root is not valid");
        require(!signerNullifierUsed[revokedSignerDelegation.signerNullifier], "ShieldedPool: signer nullifier is already used");
        
        // format public inputs
        bytes32[] memory inputs = _formatPublicInputs(revokedSignerDelegation, messageHash);

        // verify proof
        require(delegateRevocationVerifier.verify(proof, inputs), "ShieldedPool: proof is not valid");

        // mark signer nullifier as used
        signerNullifierUsed[revokedSignerDelegation.signerNullifier] = true;

        // insert new signer commitment into signer tree
        if (_isMerkleTreeSizeOverflow(_signerTrees[currentSignerTreeId], 1)) {
            currentSignerTreeId++;
            _initializeMerkleTree(_signerTrees[currentSignerTreeId]);
        }
        uint256 signerRoot = _signerTrees[currentSignerTreeId].insert(uint256(revokedSignerDelegation.signerCommitment));
        isSignerRoot[bytes32(signerRoot)] = true;

        emit SignerTreeUpdated(currentSignerTreeId, signerRoot, block.number, block.timestamp);
    }

    function shieldedTransfer(ShieldedTx memory shieldedTx, bytes calldata proof, uint256 timestamp) external {
        bytes32 messageHash = _hashTypedData(shieldedTx);

        require(timestamp > block.timestamp - TIMESTAMP_MARGIN, "ShieldedPool: timestamp is too old");
        require(timestamp < block.timestamp + TIMESTAMP_MARGIN, "ShieldedPool: timestamp is too new");

        _validateShieldedTx(shieldedTx);

        // Get verifier
        IVerifier verifier = _utxoVerifiers[shieldedTx.nullifiers.length][_outputCommitmentLength(shieldedTx)];
        require(address(verifier) != address(0), "ShieldedPool: verifier is not registered");

        // Get public inputs
        bytes32[] memory inputs = _formatPublicInputs(shieldedTx, messageHash, timestamp);

        // Verify proof
        require(verifier.verify(proof, inputs), "ShieldedPool: proof is not valid");

        _applyShieldedTransfer(shieldedTx);
    }

    function batchShieldedTransfers(
        ShieldedTx[] memory shieldedTxs,
        bytes calldata proof,
        uint256 timestamp
    ) external {
        uint256 batchSize = shieldedTxs.length;
        require(batchSize > 0, "ShieldedPool: batch is empty");

        require(timestamp > block.timestamp - TIMESTAMP_MARGIN, "ShieldedPool: timestamp is too old");
        require(timestamp < block.timestamp + TIMESTAMP_MARGIN, "ShieldedPool: timestamp is too new");

        uint256 nullifierLength = shieldedTxs[0].nullifiers.length;
        uint256 commitmentLength = _outputCommitmentLength(shieldedTxs[0]);
        bytes32[] memory messageHashes = new bytes32[](batchSize);

        for (uint256 i; i < batchSize; i++) {
            ShieldedTx memory shieldedTx = shieldedTxs[i];
            require(shieldedTx.nullifiers.length == nullifierLength, "ShieldedPool: inconsistent nullifier length");
            require(_outputCommitmentLength(shieldedTx) == commitmentLength, "ShieldedPool: inconsistent commitment length");

            messageHashes[i] = _hashTypedData(shieldedTx);
            _validateShieldedTx(shieldedTx);
            _validateBatchUniqueness(shieldedTxs, i);
        }

        IVerifier verifier = _batchUtxoVerifiers[batchSize][nullifierLength][commitmentLength];
        require(address(verifier) != address(0), "ShieldedPool: batch verifier is not registered");

        bytes32[] memory inputs = _formatBatchPublicInputs(shieldedTxs, messageHashes, timestamp);
        require(verifier.verify(proof, inputs), "ShieldedPool: proof is not valid");

        for (uint256 i; i < batchSize; i++) {
            _applyShieldedTransfer(shieldedTxs[i]);
        }
    }

    function _validateShieldedTx(ShieldedTx memory shieldedTx) internal view {
        require(masterShieldedPool.isMasterWormholeRoot(shieldedTx.wormholeRoot), "ShieldedPool: wormhole root is not valid");
        require(masterShieldedPool.isMasterShieldedRoot(shieldedTx.shieldedRoot), "ShieldedPool: shielded root is not valid");
        require(isSignerRoot[shieldedTx.signerRoot], "ShieldedPool: signer root is not valid");

        // Validate nullifiers
        require(!signerNullifierUsed[shieldedTx.signerNullifier], "ShieldedPool: signer nullifier is already used");
        require(!masterShieldedPool.wormholeNullifierUsed(shieldedTx.wormholeNullifier), "ShieldedPool: wormhole nullifier is already used");
        for (uint256 i = 0; i < shieldedTx.nullifiers.length; i++) {
            require(!masterShieldedPool.nullifierUsed(shieldedTx.nullifiers[i]), "ShieldedPool: nullifier is already used");
        }
    }

    function _validateBatchUniqueness(ShieldedTx[] memory shieldedTxs, uint256 currentIndex) internal pure {
        ShieldedTx memory current = shieldedTxs[currentIndex];

        for (uint256 i; i < currentIndex; i++) {
            ShieldedTx memory previous = shieldedTxs[i];
            require(previous.signerNullifier != current.signerNullifier, "ShieldedPool: signer nullifier is duplicated in batch");
            require(previous.wormholeNullifier != current.wormholeNullifier, "ShieldedPool: wormhole nullifier is duplicated in batch");

            for (uint256 j; j < current.nullifiers.length; j++) {
                for (uint256 k; k < previous.nullifiers.length; k++) {
                    require(previous.nullifiers[k] != current.nullifiers[j], "ShieldedPool: nullifier is duplicated in batch");
                }
            }
        }
    }

    function _applyShieldedTransfer(ShieldedTx memory shieldedTx) internal {
        // Mark nullifiers as used
        signerNullifierUsed[shieldedTx.signerNullifier] = true;
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

        // Insert new signer root into signer tree
        if (_isMerkleTreeSizeOverflow(_signerTrees[currentSignerTreeId], 1)) {
            currentSignerTreeId++;
            _initializeMerkleTree(_signerTrees[currentSignerTreeId]);
        }
        uint256 signerRoot = _signerTrees[currentSignerTreeId].insert(uint256(shieldedTx.signerCommitment));
        isSignerRoot[bytes32(signerRoot)] = true;

        // If withdrawals are present, mint new shares for each withdrawal
        masterShieldedPool.unshield(shieldedTx.withdrawals);

        emit ShieldedTransfer(currentShieldedTreeId, startIndex, shieldedTx.commitments, shieldedTx.nullifiers, shieldedTx.withdrawals);

        emit ShieldedTransferSigner(currentShieldedTreeId, startIndex, shieldedTx.signerCommitment, shieldedTx.signerNullifier);

        emit ShieldedTreeUpdated(currentShieldedTreeId, root, block.number, block.timestamp);

        emit SignerTreeUpdated(currentSignerTreeId, signerRoot, block.number, block.timestamp);

        if (block.chainid == masterShieldedPool.MASTER_CHAIN_ID()) {
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
        uint64 masterChainId = masterShieldedPool.MASTER_CHAIN_ID();
        require(chainId != masterChainId && block.chainid == masterChainId, "Branch tree cannot be master chain");
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

    function _formatPublicInputs(ShieldedTx memory shieldedTx, bytes32 messageHash, uint256 timestamp) internal view returns (bytes32[] memory inputs) {
        (bytes32 messageHashHi, bytes32 messageHashLo) = _splitHash(messageHash);

        // Public inputs ordering matches `circuits/circuits/main/delegated_utxo_2x2/src/main.nr`.
        // Public params:
        // - eip712_domain_lo
        // - eip712_domain_hi
        // - chain_id
        // - timestamp
        // - shielded_root
        // - wormhole_root
        // - signer_root
        //
        // Public return values:
        // - hashed_message_hi
        // - hashed_message_lo
        // - signer_commitment
        // - signer_nullifier
        // - wormhole_nullifier
        // - nullifiers[]
        // - commitments[]
        uint256 commitmentLength = _outputCommitmentLength(shieldedTx);
        uint256 offset = 12 + shieldedTx.nullifiers.length;
        inputs = new bytes32[](offset + commitmentLength);
        inputs[0] = _eip712DomainHashLo;
        inputs[1] = _eip712DomainHashHi;
        inputs[2] = bytes32(block.chainid);
        inputs[3] = bytes32(timestamp);
        inputs[4] = shieldedTx.shieldedRoot;
        inputs[5] = shieldedTx.wormholeRoot;
        inputs[6] = shieldedTx.signerRoot;
        inputs[7] = messageHashHi;
        inputs[8] = messageHashLo;
        inputs[9] = shieldedTx.signerCommitment;
        inputs[10] = shieldedTx.signerNullifier;
        inputs[11] = shieldedTx.wormholeNullifier;
        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            inputs[12 + i] = shieldedTx.nullifiers[i];
        }
        _fillOutputCommitments(shieldedTx, inputs, offset);
    }

    function _formatPublicInputs(RevokedSignerDelegation memory revokedSignerDelegation, bytes32 messageHash) internal view returns (bytes32[] memory inputs) {
        (bytes32 messageHashHi, bytes32 messageHashLo) = _splitHash(messageHash);
        (bytes32 delegationHashHi, bytes32 delegationHashLo) = _splitHash(revokedSignerDelegation.delegationHash);

        // Public inputs ordering matches `circuits/circuits/main/revoke_delegation/src/main.nr`.
        // Public params:
        // - eip712_domain_lo
        // - eip712_domain_hi
        // - signer_root
        // - hashed_message_hi
        // - hashed_message_lo
        // - delegation_hash_hi
        // - delegation_hash_lo
        // - signer_commitment
        // - signer_nullifier
        inputs = new bytes32[](9);
        inputs[0] = _eip712DomainHashLo;
        inputs[1] = _eip712DomainHashHi;
        inputs[2] = revokedSignerDelegation.signerRoot;
        inputs[3] = messageHashHi;
        inputs[4] = messageHashLo;
        inputs[5] = delegationHashHi;
        inputs[6] = delegationHashLo;
        inputs[7] = revokedSignerDelegation.signerCommitment;
        inputs[8] = revokedSignerDelegation.signerNullifier;
    }

    function _formatBatchPublicInputs(
        ShieldedTx[] memory shieldedTxs,
        bytes32[] memory messageHashes,
        uint256 timestamp
    ) internal view returns (bytes32[] memory inputs) {
        uint256 batchSize = shieldedTxs.length;
        uint256 nullifierLength = shieldedTxs[0].nullifiers.length;
        uint256 commitmentLength = _outputCommitmentLength(shieldedTxs[0]);
        uint256 inputNullifiersOffset = 3 + (9 * batchSize);
        uint256 outputCommitmentsOffset = inputNullifiersOffset + (batchSize * nullifierLength);
        inputs = new bytes32[](outputCommitmentsOffset + (batchSize * commitmentLength));

        inputs[0] = _eip712DomainHashLo;
        inputs[1] = _eip712DomainHashHi;
        inputs[2] = bytes32(block.chainid);

        for (uint256 i; i < batchSize; i++) {
            _fillBatchPublicInputs(
                shieldedTxs[i],
                messageHashes[i],
                inputs,
                i,
                BatchLengthsAndOffsets(batchSize, nullifierLength, commitmentLength, inputNullifiersOffset, outputCommitmentsOffset),
                timestamp
            );
        }
    }

    struct BatchLengthsAndOffsets {
        uint256 batchSize;
        uint256 nullifierLength;
        uint256 commitmentLength;
        uint256 inputNullifiersOffset;
        uint256 outputCommitmentsOffset;
    }

    function _fillBatchPublicInputs(
        ShieldedTx memory shieldedTx,
        bytes32 messageHash,
        bytes32[] memory inputs,
        uint256 batchIndex,
        BatchLengthsAndOffsets memory batchLengthsAndOffsets,
        uint256 timestamp
        // ShieldedTx memory shieldedTx,
        // bytes32 messageHash,
        // bytes32[] memory inputs,
        // uint256 batchIndex,
        // uint256 batchSize,
        // uint256 nullifierLength,
        // uint256 commitmentLength,
        // uint256 inputNullifiersOffset,
        // uint256 outputCommitmentsOffset,
        // uint256 timestamp
    ) internal view {
        (bytes32 messageHashHi, bytes32 messageHashLo) = _splitHash(messageHash);
        uint256 columnOffset = 3 + batchIndex;

        inputs[columnOffset] = bytes32(timestamp);
        inputs[columnOffset + batchLengthsAndOffsets.batchSize] = shieldedTx.shieldedRoot;
        inputs[columnOffset + (2 * batchLengthsAndOffsets.batchSize)] = shieldedTx.wormholeRoot;
        inputs[columnOffset + (3 * batchLengthsAndOffsets.batchSize)] = shieldedTx.signerRoot;
        inputs[columnOffset + (4 * batchLengthsAndOffsets.batchSize)] = messageHashHi;
        inputs[columnOffset + (5 * batchLengthsAndOffsets.batchSize)] = messageHashLo;
        inputs[columnOffset + (6 * batchLengthsAndOffsets.batchSize)] = shieldedTx.signerCommitment;
        inputs[columnOffset + (7 * batchLengthsAndOffsets.batchSize)] = shieldedTx.signerNullifier;
        inputs[columnOffset + (8 * batchLengthsAndOffsets.batchSize)] = shieldedTx.wormholeNullifier;

        uint256 nullifierOffset = batchLengthsAndOffsets.inputNullifiersOffset + (batchIndex * batchLengthsAndOffsets.nullifierLength);
        for (uint256 i; i < batchLengthsAndOffsets.nullifierLength; i++) {
            inputs[nullifierOffset + i] = shieldedTx.nullifiers[i];
        }

        _fillOutputCommitments(shieldedTx, inputs, batchLengthsAndOffsets.outputCommitmentsOffset + (batchIndex * batchLengthsAndOffsets.commitmentLength));
    }

    function _fillOutputCommitments(ShieldedTx memory shieldedTx, bytes32[] memory inputs, uint256 offset) internal view {
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

    function _outputCommitmentLength(ShieldedTx memory shieldedTx) internal pure returns (uint256) {
        return shieldedTx.commitments.length + shieldedTx.withdrawals.length;
    }

    function _splitHash(bytes32 value) internal pure returns (bytes32 hi, bytes32 lo) {
        uint256 valueUint = uint256(value);
        hi = bytes32(valueUint >> 128);
        lo = bytes32(valueUint & type(uint128).max);
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
                    shieldedTx.signerRoot,
                    shieldedTx.signerCommitment,
                    shieldedTx.signerNullifier,
                    keccak256(abi.encodePacked(shieldedTx.nullifiers)),
                    keccak256(abi.encodePacked(shieldedTx.commitments)),
                    keccak256(abi.encodePacked(withdrawalsHash))
                )
            )
        );
    }

    function _hashTypedData(SignerDelegation memory signerDelegation) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SIGNER_DELEGATION_TYPEHASH,
                    signerDelegation.chainId,
                    signerDelegation.owner,
                    signerDelegation.delegate,
                    signerDelegation.recipient,
                    signerDelegation.recipientLocked,
                    signerDelegation.startTime,
                    signerDelegation.endTime,
                    signerDelegation.token,
                    signerDelegation.tokenLocked,
                    signerDelegation.tokenId,
                    signerDelegation.amount,
                    signerDelegation.amountType,
                    signerDelegation.maxCumulativeAmount,
                    signerDelegation.maxNonce,
                    signerDelegation.timeInterval,
                    signerDelegation.transferType
                )
            )
        );
    }

    function _hashTypedData(RevokedSignerDelegation memory revokedSignerDelegation) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REVOKED_SIGNER_DELEGATION_TYPEHASH,
                    revokedSignerDelegation.delegationHash,
                    revokedSignerDelegation.signerRoot,
                    revokedSignerDelegation.signerCommitment,
                    revokedSignerDelegation.signerNullifier
                )
            )
        );
    }
}