// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../mock/MockERC20.sol";
import {MockERC4626} from "../mock/MockERC4626.sol";
import {IShieldedPool} from "../../src/interfaces/IShieldedPool.sol";
import {ShieldedPool} from "../../src/ShieldedPool.sol";
import {ShieldedPoolDelegateBranch} from "../../src/ShieldedPoolDelegateBranch.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {MockVerifier} from "../mock/MockVerifier.sol";
import {MockCrossL2Prover} from "../mock/MockCrossL2Prover.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {ERC4626Wormhole} from "../../src/wormholes/ERC4626Wormhole.sol";
import {IWormhole} from "../../src/interfaces/IWormhole.sol";
import {SNARK_SCALAR_FIELD} from "../../src/utils/Constants.sol";

contract ShieldedPoolDelegateBranchTest is Test {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("ShieldedPool");
    bytes32 internal constant VERSION_HASH = keccak256("1");
    bytes32 internal constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address to,address asset,uint256 id,uint256 amount,bytes32 confidentialContext)");
    bytes32 internal constant SHIELDED_TX_TYPEHASH = keccak256(
        "ShieldedTx(uint64 chainId,bytes32 wormholeRoot,bytes32 wormholeNullifier,bytes32 shieldedRoot,bytes32 signerRoot,bytes32 signerCommitment,bytes32 signerNullifier,bytes32[] nullifiers,uint256[] commitments,Withdrawal[] withdrawals)Withdrawal(address to,address asset,uint256 id,uint256 amount,bytes32 confidentialContext)"
    );

    MockERC20 underlying;
    MockERC4626 vault;

    address owner = makeAddr("owner");
    address screener = makeAddr("wormhole approver");
    ShieldedPool shieldedPool;
    ShieldedPoolDelegateBranch branch;
    ERC4626Wormhole wormholeVault;

    IPoseidon2 poseidon2;
    MockVerifier verifier;
    MockCrossL2Prover crossL2Prover;

    uint64 constant masterChainId = 11155111;

    function setUp() public {
        poseidon2 = IPoseidon2(address(new Poseidon2()));
        verifier = new MockVerifier();
        crossL2Prover = new MockCrossL2Prover();
        shieldedPool = new ShieldedPool(poseidon2, verifier, crossL2Prover, owner);
        branch = new ShieldedPoolDelegateBranch(IShieldedPool(address(shieldedPool)), owner);
        wormholeVault = new ERC4626Wormhole(shieldedPool);

        underlying = new MockERC20();
        vault = new MockERC4626(underlying);

        vm.startPrank(owner);
        shieldedPool.addBranch(uint64(block.chainid), address(branch));
        shieldedPool.addBranch(masterChainId, address(branch));
        shieldedPool.setWormholeApprover(screener, true);
        branch.addVerifier(verifier, 2, 2);
        vm.stopPrank();

        wormholeVault.initialize(abi.encodePacked(address(vault)));
    }

    function _dealWormholeTokens(address to, uint256 shares) internal {
        uint256 amount = vault.convertToAssets(shares);
        underlying.mint(to, amount);
        vm.startPrank(to);
        underlying.approve(address(wormholeVault), amount);
        wormholeVault.deposit(amount, to);
        vm.stopPrank();
    }

    function _prepareWormholeState()
        internal
        returns (address from, address to, bytes32 wormholeRoot, bytes32 shieldedRoot)
    {
        from = makeAddr("from");
        to = makeAddr("to");

        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, true);

        (wormholeRoot,,) = shieldedPool.masterWormholeTree(0);
        (shieldedRoot,,) = shieldedPool.masterShieldedTree(0);
    }

    function _splitHash(bytes32 value) internal pure returns (bytes32 hi, bytes32 lo) {
        uint256 valueUint = uint256(value);
        hi = bytes32(valueUint >> 128);
        lo = bytes32(valueUint & type(uint128).max);
    }

    function _domainSeparatorV4() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(branch)
            )
        );
    }

    function _hashTypedData(ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx) internal view returns (bytes32) {
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

        bytes32 structHash = keccak256(
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
        );

        return keccak256(abi.encodePacked("\x19\x01", _domainSeparatorV4(), structHash));
    }

    function _expectedPublicInputs(ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx)
        internal
        view
        returns (bytes32[] memory inputs)
    {
        (bytes32 domainHi, bytes32 domainLo) = _splitHash(_domainSeparatorV4());
        (bytes32 messageHashHi, bytes32 messageHashLo) = _splitHash(_hashTypedData(shieldedTx));

        uint256 offset = 14 + shieldedTx.nullifiers.length;
        inputs = new bytes32[](offset + shieldedTx.commitments.length + shieldedTx.withdrawals.length);

        inputs[0] = domainLo;
        inputs[1] = domainHi;
        inputs[2] = messageHashHi;
        inputs[3] = messageHashLo;
        inputs[4] = bytes32(block.chainid);
        inputs[5] = bytes32(block.timestamp);
        inputs[6] = shieldedTx.shieldedRoot;
        inputs[7] = shieldedTx.wormholeRoot;
        inputs[8] = shieldedTx.signerRoot;
        inputs[9] = messageHashHi;
        inputs[10] = messageHashLo;
        inputs[11] = shieldedTx.signerCommitment;
        inputs[12] = shieldedTx.signerNullifier;
        inputs[13] = shieldedTx.wormholeNullifier;

        for (uint256 i; i < shieldedTx.nullifiers.length; i++) {
            inputs[14 + i] = shieldedTx.nullifiers[i];
        }

        for (uint256 i; i < shieldedTx.commitments.length; i++) {
            inputs[offset + i] = bytes32(shieldedTx.commitments[i]);
        }

        for (uint256 i; i < shieldedTx.withdrawals.length; i++) {
            IShieldedPool.Withdrawal memory withdrawal = shieldedTx.withdrawals[i];
            uint256 commitment = poseidon2.hash_5(
                uint256(uint160(withdrawal.to)),
                uint256(uint160(withdrawal.asset)),
                withdrawal.id,
                withdrawal.amount,
                2
            );
            inputs[offset + shieldedTx.commitments.length + i] = bytes32(commitment);
        }
    }

    function _baseShieldedTx(bytes32 wormholeRoot, bytes32 shieldedRoot)
        internal
        pure
        returns (ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx)
    {
        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = keccak256("mock nullifier 1");
        nullifiers[1] = keccak256("mock nullifier 2");

        uint256[] memory commitments = new uint256[](2);
        commitments[0] = uint256(keccak256("mock commitment 1")) % SNARK_SCALAR_FIELD;
        commitments[1] = uint256(keccak256("mock commitment 2")) % SNARK_SCALAR_FIELD;

        shieldedTx = ShieldedPoolDelegateBranch.ShieldedTx({
            chainId: masterChainId,
            wormholeRoot: wormholeRoot,
            wormholeNullifier: keccak256("mock wormhole nullifier"),
            shieldedRoot: shieldedRoot,
            signerRoot: bytes32(0),
            signerCommitment: bytes32(uint256(keccak256("mock signer commitment")) % SNARK_SCALAR_FIELD),
            signerNullifier: keccak256("mock signer nullifier"),
            nullifiers: nullifiers,
            commitments: commitments,
            withdrawals: new IShieldedPool.Withdrawal[](0)
        });
    }

    function test_shieldedTransfer_revert_invalidSignerRoot() public {
        (, , bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        shieldedTx.signerRoot = keccak256("invalid signer root");

        vm.expectRevert("ShieldedPool: signer root is not valid");
        branch.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));
    }

    function test_constructor_seeds_firstValidSignerRoot() public view {
        assertTrue(branch.isSignerRoot(bytes32(0)), "Zero signer root should be valid at deployment");
    }

    function test_shieldedTransfer_formatsDelegatedPublicInputsForVerifier() public {
        (, , bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        bytes memory proof = abi.encodePacked("mock zk proof");
        bytes32[] memory expectedInputs = _expectedPublicInputs(shieldedTx);

        vm.expectCall(address(verifier), abi.encodeCall(IVerifier.verify, (proof, expectedInputs)));
        branch.shieldedTransfer(shieldedTx, proof);
    }

    function test_shieldedTransfer_updatesSignerStateAndEmitsEvents() public {
        (, , bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        bytes32 expectedShieldedRoot = bytes32(
            poseidon2.hash_2(shieldedTx.commitments[0], shieldedTx.commitments[1])
        );
        bytes32 expectedSignerRoot = shieldedTx.signerCommitment;

        vm.expectEmit(address(branch));
        emit ShieldedPoolDelegateBranch.ShieldedTransfer(
            0,
            0,
            shieldedTx.commitments,
            shieldedTx.nullifiers,
            shieldedTx.withdrawals,
            shieldedTx.signerCommitment,
            shieldedTx.signerNullifier
        );
        vm.expectEmit(address(branch));
        emit ShieldedPoolDelegateBranch.ShieldedTreeUpdated(0, uint256(expectedShieldedRoot), block.number, block.timestamp);
        vm.expectEmit(address(branch));
        emit ShieldedPoolDelegateBranch.SignerTreeUpdated(0, uint256(expectedSignerRoot), block.number, block.timestamp);

        branch.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));

        (bytes32 newShieldedRoot, uint256 shieldedSize, uint256 shieldedDepth) = branch.branchShieldedTree(0);
        assertEq(newShieldedRoot, expectedShieldedRoot, "Shielded root is incorrect after delegated transfer");
        assertEq(shieldedSize, 2, "Shielded tree size should be 2");
        assertEq(shieldedDepth, 1, "Shielded tree depth should be 1");

        assertTrue(branch.isSignerRoot(expectedSignerRoot), "New signer root should be marked valid");
        assertTrue(branch.signerNullifierUsed(shieldedTx.signerNullifier), "Signer nullifier should be marked used");
        assertTrue(shieldedPool.wormholeNullifierUsed(shieldedTx.wormholeNullifier), "Wormhole nullifier should be marked used");
        assertTrue(shieldedPool.nullifierUsed(shieldedTx.nullifiers[0]), "Nullifier 1 should be marked used");
        assertTrue(shieldedPool.nullifierUsed(shieldedTx.nullifiers[1]), "Nullifier 2 should be marked used");
    }

    function test_shieldedTransfer_unshield() public {
        (, address to, bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();
        address unshieldTo = makeAddr("unshield to");

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        shieldedTx.commitments = new uint256[](1);
        shieldedTx.commitments[0] = uint256(keccak256("mock commitment 1")) % SNARK_SCALAR_FIELD;
        shieldedTx.withdrawals = new IShieldedPool.Withdrawal[](1);
        shieldedTx.withdrawals[0] = IShieldedPool.Withdrawal({
            to: unshieldTo,
            asset: address(wormholeVault),
            id: 0,
            amount: 50e18,
            confidentialContext: bytes32(0)
        });

        vm.expectEmit(address(branch));
        emit ShieldedPoolDelegateBranch.ShieldedTransfer(
            0,
            0,
            shieldedTx.commitments,
            shieldedTx.nullifiers,
            shieldedTx.withdrawals,
            shieldedTx.signerCommitment,
            shieldedTx.signerNullifier
        );
        vm.expectCall(address(wormholeVault), abi.encodeWithSelector(IWormhole.unshield.selector, unshieldTo, 0, 50e18));

        branch.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));

        (bytes32 newShieldedRoot, uint256 shieldedSize, uint256 shieldedDepth) = branch.branchShieldedTree(0);
        assertEq(newShieldedRoot, bytes32(shieldedTx.commitments[0]), "Shielded root should be the single commitment");
        assertEq(shieldedSize, 1, "Shielded tree size should be 1");
        assertEq(shieldedDepth, 0, "Shielded tree depth should be 0");
        assertEq(wormholeVault.balanceOf(unshieldTo), 50e18, "Receiver should get withdrawal amount");
        assertEq(wormholeVault.balanceOf(to), 100e18, "Original recipient should retain burned balance");
    }

    function test_shieldedTransfer_revert_signerNullifierAlreadyUsed() public {
        (, , bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        bytes memory proof = abi.encodePacked("mock zk proof");

        branch.shieldedTransfer(shieldedTx, proof);

        vm.expectRevert("ShieldedPool: signer nullifier is already used");
        branch.shieldedTransfer(shieldedTx, proof);
    }

    function test_shieldedTransfer_revert_invalidProof() public {
        (, , bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        verifier.setReturnValue(false);

        vm.expectRevert("ShieldedPool: proof is not valid");
        branch.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));
    }

    function test_shieldedTransfer_acceptsNextSignerRootAfterFirstTransfer() public {
        (, , bytes32 wormholeRoot, bytes32 shieldedRoot) = _prepareWormholeState();

        ShieldedPoolDelegateBranch.ShieldedTx memory firstTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        branch.shieldedTransfer(firstTx, abi.encodePacked("first proof"));

        ShieldedPoolDelegateBranch.ShieldedTx memory secondTx = _baseShieldedTx(wormholeRoot, shieldedRoot);
        secondTx.signerRoot = firstTx.signerCommitment;
        secondTx.signerCommitment = bytes32(uint256(keccak256("second signer commitment")) % SNARK_SCALAR_FIELD);
        secondTx.signerNullifier = keccak256("second signer nullifier");
        secondTx.wormholeNullifier = keccak256("second wormhole nullifier");
        secondTx.nullifiers[0] = keccak256("second nullifier 1");
        secondTx.nullifiers[1] = keccak256("second nullifier 2");
        secondTx.commitments[0] = uint256(keccak256("second commitment 1")) % SNARK_SCALAR_FIELD;
        secondTx.commitments[1] = uint256(keccak256("second commitment 2")) % SNARK_SCALAR_FIELD;

        branch.shieldedTransfer(secondTx, abi.encodePacked("second proof"));

        bytes32 expectedSecondSignerRoot = bytes32(
            poseidon2.hash_2(uint256(firstTx.signerCommitment), uint256(secondTx.signerCommitment))
        );

        assertTrue(branch.signerNullifierUsed(firstTx.signerNullifier), "First signer nullifier should remain used");
        assertTrue(branch.signerNullifierUsed(secondTx.signerNullifier), "Second signer nullifier should be marked used");
        assertTrue(branch.isSignerRoot(firstTx.signerCommitment), "First signer root should remain valid");
        assertTrue(branch.isSignerRoot(expectedSecondSignerRoot), "Second signer tree root should become valid");
    }

    function _encodeBranchTreesUpdatedTopics(uint256 shieldedTreeId, bytes32 shieldedTreeRoot)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 eventSig = ShieldedPoolDelegateBranch.ShieldedTreeUpdated.selector;
        return abi.encodePacked(eventSig, bytes32(shieldedTreeId), shieldedTreeRoot);
    }

    function _setupBranchEventProof(
        uint32 chainId,
        address emittingContract,
        uint256 shieldedTreeRoot,
        uint256 blockNumber,
        bool valid
    ) internal {
        uint256 treeId = 0;
        bytes memory topics = _encodeBranchTreesUpdatedTopics(treeId, bytes32(shieldedTreeRoot));
        bytes memory unindexedData = abi.encode(blockNumber, uint256(1000));
        crossL2Prover.setValidateEventReturn(chainId, emittingContract, topics, unindexedData, valid);
    }

    function test_updateMasterTrees_masterChain_validBranchEvent() public {
        vm.chainId(masterChainId);
        vm.prank(owner);
        shieldedPool.addBranch(42, address(branch));

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(branch), branchShieldedRoot, 100, true);

        branch.updateMasterTrees(abi.encodePacked("proof"));

        (bytes32 masterShieldedRoot, uint256 shieldedSize,) = shieldedPool.masterShieldedTree(0);
        assertEq(uint256(masterShieldedRoot), branchShieldedRoot, "Master shielded root should equal branch shielded root");
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRoot), "Master shielded root should be marked valid");
        assertEq(shieldedSize, 1, "Master shielded tree should have 1 leaf");
    }

    function test_updateMasterTrees_masterChain_emitsMasterTreesUpdated() public {
        vm.chainId(masterChainId);
        vm.prank(owner);
        shieldedPool.addBranch(42, address(branch));

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(branch), branchShieldedRoot, 100, true);

        (bytes32 currentMasterWormholeRoot,,) = shieldedPool.masterWormholeTree(0);

        vm.expectEmit(true, true, false, true, address(shieldedPool));
        emit ShieldedPool.MasterTreesUpdated(0, 0, branchShieldedRoot, uint256(currentMasterWormholeRoot), block.number, block.timestamp);
        branch.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_invalidEmittingContract() public {
        vm.chainId(masterChainId);
        vm.prank(owner);
        shieldedPool.addBranch(42, address(branch));

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(0xdead), branchShieldedRoot, 100, true);

        vm.expectRevert("Invalid emitting contract");
        branch.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_invalidTopicsLength() public {
        vm.chainId(masterChainId);
        vm.prank(owner);
        shieldedPool.addBranch(42, address(branch));

        bytes memory invalidTopics = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)));
        bytes memory unindexedData = abi.encode(uint256(100), uint256(1000));
        crossL2Prover.setValidateEventReturn(42, address(branch), invalidTopics, unindexedData, true);

        vm.expectRevert("Invalid topics length");
        branch.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_staleBlockNumber() public {
        vm.chainId(masterChainId);
        vm.prank(owner);
        shieldedPool.addBranch(42, address(branch));

        uint256 firstRoot = uint256(keccak256("branch shielded root 1")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(branch), firstRoot, 100, true);
        branch.updateMasterTrees(abi.encodePacked("proof"));

        uint256 secondRoot = uint256(keccak256("branch shielded root 2")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(branch), secondRoot, 100, true);

        vm.expectRevert("Branch tree event is not new");
        branch.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_invalidProof() public {
        vm.chainId(masterChainId);
        vm.prank(owner);
        shieldedPool.addBranch(42, address(branch));

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(branch), branchShieldedRoot, 100, false);

        vm.expectRevert("Mock configured to return invalid data");
        branch.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_shieldedTransfer_masterChain_updatesMasterShieldedTree() public {
        vm.chainId(masterChainId);

        address from = makeAddr("from");
        address to = makeAddr("to");
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, true);

        (bytes32 wormholeRoot,,) = shieldedPool.masterWormholeTree(0);
        (bytes32 shieldedRoot,,) = shieldedPool.masterShieldedTree(0);

        ShieldedPoolDelegateBranch.ShieldedTx memory shieldedTx = _baseShieldedTx(wormholeRoot, shieldedRoot);

        branch.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));

        (bytes32 masterShieldedRootAfter, uint256 masterShieldedSize,) = shieldedPool.masterShieldedTree(0);
        (bytes32 branchShieldedRoot, uint256 branchSize,) = branch.branchShieldedTree(0);
        bytes32 expectedBranchRoot = bytes32(poseidon2.hash_2(shieldedTx.commitments[0], shieldedTx.commitments[1]));

        assertEq(branchShieldedRoot, expectedBranchRoot, "Branch shielded root should be hash of commitments");
        assertEq(branchSize, 2, "Branch shielded tree should have 2 commitment leaves");
        assertEq(masterShieldedSize, 1, "Master shielded tree should have 1 leaf");
        assertEq(uint256(masterShieldedRootAfter), uint256(branchShieldedRoot), "Master root should equal branch root for single leaf");
    }
}
