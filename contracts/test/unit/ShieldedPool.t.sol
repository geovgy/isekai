// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {MockERC20} from "../mock/MockERC20.sol";
import {MockERC4626} from "../mock/MockERC4626.sol";
import {IShieldedPool} from "../../src/interfaces/IShieldedPool.sol";
import {ShieldedPool} from "../../src/ShieldedPool.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {MockVerifier} from "../mock/MockVerifier.sol";
import {MockCrossL2Prover} from "../mock/MockCrossL2Prover.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {ERC4626Wormhole} from "../../src/wormholes/ERC4626Wormhole.sol";
import {IWormhole} from "../../src/interfaces/IWormhole.sol";
import {SNARK_SCALAR_FIELD} from "../../src/utils/Constants.sol";

contract ShieldedPoolTest is Test {
    MockERC20 underlying;
    MockERC4626 vault;
    
    address owner = makeAddr("owner");
    address screener = makeAddr("wormhole approver");
    ShieldedPool shieldedPool;
    ERC4626Wormhole wormholeVault;

    IPoseidon2 poseidon2;
    MockVerifier verifier;
    MockCrossL2Prover crossL2Prover;

    uint64 constant masterChainId = 11155111;

    function _dealWormholeTokens(address to, uint256 shares) internal {
        uint256 amount = vault.convertToAssets(shares);
        underlying.mint(to, amount);
        vm.startPrank(to);
        underlying.approve(address(wormholeVault), amount);
        wormholeVault.deposit(amount, to);
        vm.stopPrank();
    }

    function _getWormholeCommitment(uint256 entryId, bool approved, address from, address to, address token, uint256 tokenId, uint256 amount) internal view returns (uint256) {
        uint256 idHash = poseidon2.hash_2(block.chainid, entryId);
        uint256[] memory inputs = new uint256[](8);
        inputs[0] = idHash;
        inputs[1] = approved ? 1 : 0;
        inputs[2] = uint256(uint160(from));
        inputs[3] = uint256(uint160(to));
        inputs[4] = uint256(uint160(token));
        inputs[5] = tokenId;
        inputs[6] = amount;
        inputs[7] = 0;
        return poseidon2.hash(inputs);
    }

    function setUp() public {
        // deploy contracts
        poseidon2 = IPoseidon2(address(new Poseidon2()));
        verifier = new MockVerifier();
        crossL2Prover = new MockCrossL2Prover();
        shieldedPool = new ShieldedPool(poseidon2, verifier, crossL2Prover, owner);
        wormholeVault = new ERC4626Wormhole(shieldedPool);

        underlying = new MockERC20();
        vault = new MockERC4626(underlying);

        // add utxo verifier
        vm.prank(owner);
        shieldedPool.addVerifier(verifier, 2, 2);

        // add approver
        vm.prank(owner);
        shieldedPool.setWormholeApprover(screener, true);

        // initialize wormhole vault
        bytes memory initData = abi.encodePacked(address(vault));
        wormholeVault.initialize(initData);
    }

    function test_requestWormholeEntry_fromTransfers() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");

        _dealWormholeTokens(from, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 1, "Should increment total wormhole entries by 1 after deposit");

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 1 after transfer");

        vm.prank(to);
        wormholeVault.redeem(100e18, to, to);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should not change total wormhole entries after burn");

        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(1);
        assertEq(entry.from, from, "Entry from address should equal sender");
        assertEq(entry.to, to, "Entry to address should equal transfer to");
        assertEq(entry.asset, address(wormholeVault), "Entry asset should equal wormhole vault address");
        assertEq(entry.id, 0, "Entry should have id 0 for ERC20 tokens");
        assertEq(entry.amount, 100e18, "Entry should equal transfer amount");
    }

    function test_appendWormholeLeaf() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");

        uint256 expectedCommitment = _getWormholeCommitment(1, true, from, to, address(wormholeVault), 0, 100e18);

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(1, expectedCommitment, 0, 0, address(wormholeVault), 0, from, to, 100e18, true);
        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, true);

        vm.expectRevert("ShieldedPool: entry is already committed in wormhole tree");
        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, false);

        bytes32 expectedRoot = bytes32(expectedCommitment);
        (bytes32 wormholeRoot, uint256 size, uint256 depth) = shieldedPool.branchWormholeTree(0);
        assertEq(wormholeRoot, expectedRoot, "Wormhole root should be the same");
        assertEq(size, 1, "Wormhole tree size should be 1");
        assertEq(depth, 0, "Wormhole tree depth should be 0");

        assertEq(shieldedPool.totalWormholeCommitments(), 1, "Incorrect total wormhole commitments");
    }

    function test_appendManyWormholeLeaves() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");

        IShieldedPool.WormholePreCommitment[] memory nodes = new IShieldedPool.WormholePreCommitment[](2);
        nodes[0] = IShieldedPool.WormholePreCommitment({entryId: 0, approved: false});
        nodes[1] = IShieldedPool.WormholePreCommitment({entryId: 1, approved: true});

        uint256[2] memory expectedCommitments = [
            _getWormholeCommitment(0, nodes[0].approved, address(0), from, address(wormholeVault), 0, 100e18),
            _getWormholeCommitment(1, nodes[1].approved, from, to, address(wormholeVault), 0, 100e18)
        ];

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(nodes[0].entryId, expectedCommitments[0], 0, 0, address(wormholeVault), 0, address(0), from, 100e18, nodes[0].approved);
        emit ShieldedPool.WormholeCommitment(nodes[1].entryId, expectedCommitments[1], 0, 1, address(wormholeVault), 0, from, to, 100e18, nodes[1].approved);
        vm.prank(screener);
        shieldedPool.appendManyWormholeLeaves(nodes);

        bytes32 expectedRoot = bytes32(poseidon2.hash_2(expectedCommitments[0], expectedCommitments[1]));

        (bytes32 wormholeRoot, uint256 size, uint256 depth) = shieldedPool.branchWormholeTree(0);
        assertEq(wormholeRoot, expectedRoot, "Wormhole root should be the same");
        assertEq(size, 2, "Wormhole tree size should be 2");
        assertEq(depth, 1, "Wormhole tree depth should be 1");

        assertEq(shieldedPool.totalWormholeCommitments(), 2, "Incorrect total wormhole commitments");
    }

    function test_appendManyWormholeLeaves_revert_invalidLength() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");

        IShieldedPool.WormholePreCommitment[] memory nodes = new IShieldedPool.WormholePreCommitment[](3);
        nodes[0] = IShieldedPool.WormholePreCommitment({entryId: 0, approved: false});
        nodes[1] = IShieldedPool.WormholePreCommitment({entryId: 1, approved: true});
        nodes[2] = IShieldedPool.WormholePreCommitment({entryId: 2, approved: false});

        vm.expectRevert("ShieldedPool: invalid nodes length");
        vm.prank(screener);
        shieldedPool.appendManyWormholeLeaves(new IShieldedPool.WormholePreCommitment[](0));
    }

    function test_initiateRagequit() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        
        _dealWormholeTokens(from, 100e18);
        
        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");

        // Only original sender should initiate ragequit
        vm.expectRevert("ShieldedPool: caller is not the original sender");
        shieldedPool.initiateRagequit(1);

        uint256 expectedCommitment = _getWormholeCommitment(1, false, from, to, address(wormholeVault), 0, 100e18);

        // Should succeed
        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(1, expectedCommitment, 0, 0, address(wormholeVault), 0, from, to, 100e18, false);
        vm.prank(from);
        shieldedPool.initiateRagequit(1);
        
        // Should revert since entry is already committed
        vm.expectRevert("ShieldedPool: entry is already committed in wormhole tree");
        vm.prank(from);
        shieldedPool.initiateRagequit(1);

        expectedCommitment = _getWormholeCommitment(0, false, address(0), from, address(wormholeVault), 0, 100e18);

        // Can still append leafs of older entries skipped
        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(0, expectedCommitment, 0, 1, address(wormholeVault), 0, address(0), from, 100e18, false);
        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(0, false);

        assertEq(shieldedPool.totalWormholeCommitments(), 2, "Incorrect total wormhole commitments");
    }

    function test_ragequit() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");

        // append wormhole leaf
        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, false);

        // ragequit
        (bytes32 root,,) = shieldedPool.masterWormholeTree(0);
        ShieldedPool.RagequitTx memory ragequitTx = ShieldedPool.RagequitTx({
            entryId: 1, 
            approved: false, 
            wormholeRoot: root, 
            wormholeNullifier: keccak256(abi.encodePacked("mock nullifier"))
        });
        bytes memory proof = abi.encodePacked("mock zk proof");

        assertEq(shieldedPool.wormholeNullifierUsed(ragequitTx.wormholeNullifier), false, "Nullifier should not be marked as used yet");

        // Should fail if root is not valid
        ragequitTx.wormholeRoot = keccak256(abi.encodePacked("invalid wormhole root"));
        vm.expectRevert("ShieldedPool: wormhole root is not valid");
        shieldedPool.ragequit(ragequitTx, proof);

        // Set wormhole root back
        ragequitTx.wormholeRoot = root;

        // Should fail if proof is not valid
        verifier.setReturnValue(false);
        vm.expectRevert("ShieldedPool: proof is not valid");
        shieldedPool.ragequit(ragequitTx, proof);

        // Set verifier back to true
        verifier.setReturnValue(true);

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.Ragequit(1, address(this), from, address(wormholeVault), 0, 100e18);
        emit ShieldedPool.WormholeNullifier(ragequitTx.wormholeNullifier);
        // Anyone can ragequit the entry as long as the proof is valid
        vm.expectCall(address(wormholeVault), abi.encodeWithSelector(IWormhole.unshield.selector, from, 0, 100e18));
        shieldedPool.ragequit(ragequitTx, proof);

        // Should fail if nullifier is already used
        vm.expectRevert("ShieldedPool: wormhole nullifier is already used");
        shieldedPool.ragequit(ragequitTx, proof);

        assertEq(shieldedPool.wormholeNullifierUsed(ragequitTx.wormholeNullifier), true, "Nullifier should be marked as used");
        assertEq(wormholeVault.balanceOf(from), 100e18, "from address should have the full transfer amount back (via minting new shares) after ragequit");
        assertEq(wormholeVault.balanceOf(to), 100e18, "to address should still have the original transfer amount (as burn address)");
        assertEq(wormholeVault.totalSupply(), 200e18, "Total supply should increase by the transfer amount after ragequit");
        assertEq(wormholeVault.actualSupply(), 100e18, "Actual supply should no change after ragequit");
    }

    function test_shieldedTransfer() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");
        
        // append wormhole leaf
        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, true);

        // shield transfer
        (bytes32 wormholeRoot,,) = shieldedPool.masterWormholeTree(0);
        (bytes32 shieldedRoot, uint256 size,) = shieldedPool.masterShieldedTree(0);
        assertTrue(shieldedRoot == bytes32(0) && size == 0, "Shielded root and size should be 0 before any commitments inserted");
        
        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = keccak256(abi.encodePacked("mock nullifier 1"));
        nullifiers[1] = keccak256(abi.encodePacked("mock nullifier 2"));
        uint256[] memory commitments = new uint256[](2);
        commitments[0] = uint256(keccak256(abi.encodePacked("mock commitment 1"))) % SNARK_SCALAR_FIELD;
        commitments[1] = uint256(keccak256(abi.encodePacked("mock commitment 2"))) % SNARK_SCALAR_FIELD;
        ShieldedPool.ShieldedTx memory shieldedTx = ShieldedPool.ShieldedTx({
            chainId: masterChainId,
            wormholeRoot: wormholeRoot,
            wormholeNullifier: keccak256(abi.encodePacked("mock wormhole nullifier")),
            shieldedRoot: shieldedRoot,
            nullifiers: nullifiers,
            commitments: commitments,
            withdrawals: new ShieldedPool.Withdrawal[](0)
        });
        bytes memory proof = abi.encodePacked("mock zk proof");

        // Should fail if wormhole root is not valid
        shieldedTx.wormholeRoot = keccak256(abi.encodePacked("invalid wormhole root"));
        vm.expectRevert("ShieldedPool: wormhole root is not valid");
        shieldedPool.shieldedTransfer(shieldedTx, proof);

        // Set wormhole root back
        shieldedTx.wormholeRoot = wormholeRoot;

        // Should fail if shielded root is not valid
        shieldedTx.shieldedRoot = keccak256(abi.encodePacked("invalid shielded root"));
        vm.expectRevert("ShieldedPool: shielded root is not valid");
        shieldedPool.shieldedTransfer(shieldedTx, proof);

        // Set shielded root back
        shieldedTx.shieldedRoot = shieldedRoot;

        // Should fail if proof is not valid
        verifier.setReturnValue(false);
        vm.expectRevert("ShieldedPool: proof is not valid");
        shieldedPool.shieldedTransfer(shieldedTx, proof);

        // Set verifier back to true
        verifier.setReturnValue(true);

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.ShieldedTransfer(0, 0, commitments, nullifiers, shieldedTx.withdrawals);
        shieldedPool.shieldedTransfer(shieldedTx, proof);

        // Should fail if nullifier is already used
        vm.expectRevert("ShieldedPool: wormhole nullifier is already used");
        shieldedPool.shieldedTransfer(shieldedTx, proof);

        bytes32 expectedRoot = bytes32(poseidon2.hash_2(commitments[0], commitments[1]));
        (bytes32 newShieldedRoot, uint256 newSize, uint256 newDepth) = shieldedPool.branchShieldedTree(0);
        (bytes32 masterShieldedRoot,,) = shieldedPool.masterShieldedTree(0);
        assertEq(newShieldedRoot, expectedRoot, "Shielded root is incorrect after shield transfer");
        assertEq(newSize, 2, "Shielded tree size should be 2");
        assertEq(newDepth, 1, "Shielded tree depth should be 1");
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRoot), "Shielded root should be marked as valid");
        
        (bytes32 newWormholeRoot,,) = shieldedPool.masterWormholeTree(0);
        assertEq(newWormholeRoot, wormholeRoot, "Wormhole root should not change after shield transfer");

        assertEq(shieldedPool.wormholeNullifierUsed(shieldedTx.wormholeNullifier), true, "Wormhole nullifier should be marked as used");
        assertEq(shieldedPool.nullifierUsed(nullifiers[0]), true, "Nullifier 1 should be marked as used");
        assertEq(shieldedPool.nullifierUsed(nullifiers[1]), true, "Nullifier 2 should be marked as used");
        assertEq(wormholeVault.totalSupply(), 100e18, "Total supply should not change after shield transfer");
        assertEq(wormholeVault.actualSupply(), 100e18, "Actual supply should not change after shield transfer");
    }

    function test_shieldedTransfer_unshield() public {
        uint256 entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 0, "Should start with 0 total wormhole entries");

        address from = makeAddr("from");
        address to = makeAddr("to");
        address unshieldTo = makeAddr("unshield to");
        
        _dealWormholeTokens(from, 100e18);

        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        entryCount = shieldedPool.totalWormholeEntries();
        assertEq(entryCount, 2, "Should increment total wormhole entries by 2 after transfer");
        
        // append wormhole leaf
        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, true);

        // shield transfer
        (bytes32 wormholeRoot,,) = shieldedPool.masterWormholeTree(0);
        (bytes32 shieldedRoot, uint256 size,) = shieldedPool.masterShieldedTree(0);
        assertTrue(shieldedRoot == bytes32(0) && size == 0, "Shielded root and size should be 0 before any commitments inserted");
        
        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = keccak256(abi.encodePacked("mock nullifier 1"));
        nullifiers[1] = keccak256(abi.encodePacked("mock nullifier 2"));
        uint256[] memory commitments = new uint256[](1);
        commitments[0] = uint256(keccak256(abi.encodePacked("mock commitment 1"))) % SNARK_SCALAR_FIELD;
        ShieldedPool.Withdrawal[] memory withdrawals = new ShieldedPool.Withdrawal[](1);
        withdrawals[0] = ShieldedPool.Withdrawal({
            to: unshieldTo,
            asset: address(wormholeVault),
            id: 0,
            amount: 50e18
        });

        ShieldedPool.ShieldedTx memory shieldedTx = ShieldedPool.ShieldedTx({
            chainId: masterChainId,
            wormholeRoot: wormholeRoot,
            wormholeNullifier: keccak256(abi.encodePacked("mock wormhole nullifier")),
            shieldedRoot: shieldedRoot,
            nullifiers: nullifiers,
            commitments: commitments,
            withdrawals: withdrawals
        });
        bytes memory proof = abi.encodePacked("mock zk proof");

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.ShieldedTransfer(0, 0, commitments, nullifiers, withdrawals);
        vm.expectCall(address(wormholeVault), abi.encodeWithSelector(IWormhole.unshield.selector, unshieldTo, 0, 50e18));
        shieldedPool.shieldedTransfer(shieldedTx, proof);

        (bytes32 newShieldedRoot, uint256 newSize, uint256 newDepth) = shieldedPool.branchShieldedTree(0);
        assertEq(newShieldedRoot, bytes32(commitments[0]), "Shielded root should be the single commitment");
        assertEq(newSize, 1, "Shielded tree size should be 1");
        assertEq(newDepth, 0, "Shielded tree depth should be 0");

        assertEq(shieldedPool.wormholeNullifierUsed(shieldedTx.wormholeNullifier), true, "Wormhole nullifier should be marked as used");
        assertEq(shieldedPool.nullifierUsed(nullifiers[0]), true, "Nullifier 1 should be marked as used");
        assertEq(shieldedPool.nullifierUsed(nullifiers[1]), true, "Nullifier 2 should be marked as used");
        assertEq(wormholeVault.balanceOf(unshieldTo), 50e18, "receiver address should get withdrawal amount (via minting new shares)");
        assertEq(wormholeVault.balanceOf(to), 100e18, "to address should still have the original transfer amount (as burn address)");
        assertEq(wormholeVault.totalSupply(), 150e18, "Total supply should increase by the withdrawal amount");
        assertEq(wormholeVault.actualSupply(), 100e18, "Actual supply should not change after unshielding");
    }

    // ========================================
    // Cross-chain event proof validation tests
    // ========================================

    function _encodeBranchTreesUpdatedTopics(
        uint256 branchShieldedRoot,
        uint256 branchWormholeRoot
    ) internal pure returns (bytes memory) {
        bytes32 eventSig = ShieldedPool.BranchTreesUpdated.selector;
        return abi.encodePacked(eventSig, bytes32(branchShieldedRoot), bytes32(branchWormholeRoot));
    }

    function _encodeMasterTreesUpdatedTopics(
        uint256 masterShieldedRoot,
        uint256 masterWormholeRoot
    ) internal pure returns (bytes memory) {
        bytes32 eventSig = ShieldedPool.MasterTreesUpdated.selector;
        return abi.encodePacked(eventSig, bytes32(masterShieldedRoot), bytes32(masterWormholeRoot));
    }

    function _setupBranchEventProof(
        uint32 chainId,
        address emittingContract,
        uint256 branchShieldedRoot,
        uint256 branchWormholeRoot,
        uint256 blockNumber,
        bool valid
    ) internal {
        bytes memory topics = _encodeBranchTreesUpdatedTopics(branchShieldedRoot, branchWormholeRoot);
        bytes memory unindexedData = abi.encode(uint256(0), uint256(0), blockNumber, uint256(1000));
        crossL2Prover.setValidateEventReturn(chainId, emittingContract, topics, unindexedData, valid);
    }

    function _setupMasterEventProof(
        uint32 chainId,
        address emittingContract,
        uint256 masterShieldedRoot,
        uint256 masterWormholeRoot,
        uint256 blockNumber,
        uint256 blockTimestamp,
        bool valid
    ) internal {
        bytes memory topics = _encodeMasterTreesUpdatedTopics(masterShieldedRoot, masterWormholeRoot);
        bytes memory unindexedData = abi.encode(uint256(0), uint256(0), blockNumber, blockTimestamp);
        crossL2Prover.setValidateEventReturn(chainId, emittingContract, topics, unindexedData, valid);
    }

    // -------------------------------------------------------------------
    // Master chain (chainId == 1): updateMasterTrees with branch events
    // -------------------------------------------------------------------

    function test_updateMasterTrees_masterChain_validBranchEvent() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot = uint256(keccak256("branch wormhole root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot, branchWormholeRoot, 100, true);

        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        (bytes32 masterShieldedRoot, uint256 shieldedSize,) = shieldedPool.masterShieldedTree(0);
        (bytes32 masterWormholeRoot, uint256 wormholeSize,) = shieldedPool.masterWormholeTree(0);

        // First insert into empty tree: root == leaf value
        assertEq(uint256(masterShieldedRoot), branchShieldedRoot, "Master shielded root should equal branch shielded root");
        assertEq(uint256(masterWormholeRoot), branchWormholeRoot, "Master wormhole root should equal branch wormhole root");
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRoot), "Master shielded root should be marked valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(masterWormholeRoot), "Master wormhole root should be marked valid");
        assertEq(shieldedSize, 1, "Master shielded tree should have 1 leaf");
        assertEq(wormholeSize, 1, "Master wormhole tree should have 1 leaf");
    }

    function test_updateMasterTrees_masterChain_emitsMasterTreesUpdated() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot = uint256(keccak256("branch wormhole root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot, branchWormholeRoot, 100, true);

        vm.expectEmit(true, true, false, true, address(shieldedPool));
        emit ShieldedPool.MasterTreesUpdated(0, 0, branchShieldedRoot, branchWormholeRoot, block.number, block.timestamp);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_branchChainIdIsMaster() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot = uint256(keccak256("branch wormhole root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(uint32(masterChainId), address(shieldedPool), branchShieldedRoot, branchWormholeRoot, 100, true);

        vm.expectRevert("Branch tree cannot be master chain");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_invalidEmittingContract() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot = uint256(keccak256("branch wormhole root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(0xdead), branchShieldedRoot, branchWormholeRoot, 100, true);

        vm.expectRevert("Invalid emitting contract");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_invalidTopicsLength() public {
        vm.chainId(masterChainId);

        // 64 bytes instead of 96 (missing one topic word)
        bytes memory invalidTopics = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)));
        bytes memory unindexedData = abi.encode(uint256(0), uint256(0), uint256(100), uint256(1000));
        crossL2Prover.setValidateEventReturn(42, address(shieldedPool), invalidTopics, unindexedData, true);

        vm.expectRevert("Invalid topics length");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_staleBlockNumber() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot1 = uint256(keccak256("branch shielded root 1")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot1 = uint256(keccak256("branch wormhole root 1")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot1, branchWormholeRoot1, 100, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        // Same block number from same chain should revert
        uint256 branchShieldedRoot2 = uint256(keccak256("branch shielded root 2")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot2 = uint256(keccak256("branch wormhole root 2")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot2, branchWormholeRoot2, 100, true);

        vm.expectRevert("Branch tree event is not new");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_olderBlockNumber() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot1 = uint256(keccak256("branch shielded root 1")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot1 = uint256(keccak256("branch wormhole root 1")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot1, branchWormholeRoot1, 100, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        // Older block number should revert
        uint256 branchShieldedRoot2 = uint256(keccak256("branch shielded root 2")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot2 = uint256(keccak256("branch wormhole root 2")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot2, branchWormholeRoot2, 50, true);

        vm.expectRevert("Branch tree event is not new");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_revert_invalidProof() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot = uint256(keccak256("branch shielded root")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot = uint256(keccak256("branch wormhole root")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot, branchWormholeRoot, 100, false);

        vm.expectRevert("Mock configured to return invalid data");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_masterChain_multipleUpdatesFromDifferentChains() public {
        vm.chainId(masterChainId);

        // First update from chain 42
        uint256 branchShieldedRoot1 = uint256(keccak256("branch shielded root 1")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot1 = uint256(keccak256("branch wormhole root 1")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot1, branchWormholeRoot1, 100, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        (bytes32 masterShieldedRoot1,,) = shieldedPool.masterShieldedTree(0);
        (bytes32 masterWormholeRoot1,,) = shieldedPool.masterWormholeTree(0);

        // Second update from chain 10
        uint256 branchShieldedRoot2 = uint256(keccak256("branch shielded root 2")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot2 = uint256(keccak256("branch wormhole root 2")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(10, address(shieldedPool), branchShieldedRoot2, branchWormholeRoot2, 200, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        (bytes32 masterShieldedRoot2, uint256 shieldedSize,) = shieldedPool.masterShieldedTree(0);
        (bytes32 masterWormholeRoot2, uint256 wormholeSize,) = shieldedPool.masterWormholeTree(0);

        // Two-element tree: root = poseidon2(leaf1, leaf2)
        bytes32 expectedShieldedRoot = bytes32(poseidon2.hash_2(branchShieldedRoot1, branchShieldedRoot2));
        bytes32 expectedWormholeRoot = bytes32(poseidon2.hash_2(branchWormholeRoot1, branchWormholeRoot2));

        assertEq(masterShieldedRoot2, expectedShieldedRoot, "Master shielded root should be poseidon hash of both branch roots");
        assertEq(masterWormholeRoot2, expectedWormholeRoot, "Master wormhole root should be poseidon hash of both branch roots");
        assertEq(shieldedSize, 2, "Master shielded tree should have 2 leaves");
        assertEq(wormholeSize, 2, "Master wormhole tree should have 2 leaves");

        // All historical master roots should remain valid
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRoot1), "First master shielded root should still be valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(masterWormholeRoot1), "First master wormhole root should still be valid");
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRoot2), "Second master shielded root should be valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(masterWormholeRoot2), "Second master wormhole root should be valid");
    }

    function test_updateMasterTrees_masterChain_sameChainSequentialUpdates() public {
        vm.chainId(masterChainId);

        uint256 branchShieldedRoot1 = uint256(keccak256("branch shielded root 1")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot1 = uint256(keccak256("branch wormhole root 1")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot1, branchWormholeRoot1, 100, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        // Same chain, higher block number succeeds
        uint256 branchShieldedRoot2 = uint256(keccak256("branch shielded root 2")) % SNARK_SCALAR_FIELD;
        uint256 branchWormholeRoot2 = uint256(keccak256("branch wormhole root 2")) % SNARK_SCALAR_FIELD;
        _setupBranchEventProof(42, address(shieldedPool), branchShieldedRoot2, branchWormholeRoot2, 200, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        (bytes32 masterShieldedRoot, uint256 shieldedSize,) = shieldedPool.masterShieldedTree(0);
        (bytes32 masterWormholeRoot, uint256 wormholeSize,) = shieldedPool.masterWormholeTree(0);

        assertEq(shieldedSize, 2, "Master shielded tree should have 2 leaves after sequential updates");
        assertEq(wormholeSize, 2, "Master wormhole tree should have 2 leaves after sequential updates");
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRoot), "Latest master shielded root should be valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(masterWormholeRoot), "Latest master wormhole root should be valid");
    }

    // -------------------------------------------------------------------
    // Branch chain (chainId != 1): updateMasterTrees with master events
    // -------------------------------------------------------------------

    function test_updateMasterTrees_branchChain_validMasterEvent() public {
        // Default chainId is 31337 (branch chain)
        uint256 masterShieldedRoot = uint256(keccak256("master shielded root")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot = uint256(keccak256("master wormhole root")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), masterShieldedRoot, masterWormholeRoot, 100, 1000, true);

        assertFalse(shieldedPool.isMasterShieldedRoot(bytes32(masterShieldedRoot)), "Should not be valid before update");
        assertFalse(shieldedPool.isMasterWormholeRoot(bytes32(masterWormholeRoot)), "Should not be valid before update");

        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        assertTrue(shieldedPool.isMasterShieldedRoot(bytes32(masterShieldedRoot)), "Master shielded root should be valid after update");
        assertTrue(shieldedPool.isMasterWormholeRoot(bytes32(masterWormholeRoot)), "Master wormhole root should be valid after update");
    }

    function test_updateMasterTrees_branchChain_revert_chainIdNotOne() public {
        uint256 masterShieldedRoot = uint256(keccak256("master shielded root")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot = uint256(keccak256("master wormhole root")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(42, address(shieldedPool), masterShieldedRoot, masterWormholeRoot, 100, 1000, true);

        vm.expectRevert("Invalid chain id");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_branchChain_revert_invalidEmittingContract() public {
        uint256 masterShieldedRoot = uint256(keccak256("master shielded root")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot = uint256(keccak256("master wormhole root")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(0xdead), masterShieldedRoot, masterWormholeRoot, 100, 1000, true);

        vm.expectRevert("Invalid emitting contract");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_branchChain_revert_invalidTopicsLength() public {
        bytes memory invalidTopics = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)));
        bytes memory unindexedData = abi.encode(uint256(0), uint256(0), uint256(100), uint256(1000));
        crossL2Prover.setValidateEventReturn(uint32(masterChainId), address(shieldedPool), invalidTopics, unindexedData, true);

        vm.expectRevert("Invalid topics length");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_branchChain_revert_invalidProof() public {
        uint256 masterShieldedRoot = uint256(keccak256("master shielded root")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot = uint256(keccak256("master wormhole root")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), masterShieldedRoot, masterWormholeRoot, 100, 1000, false);

        vm.expectRevert("Mock configured to return invalid data");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));
    }

    function test_updateMasterTrees_branchChain_multipleUpdates() public {
        uint256 masterShieldedRoot1 = uint256(keccak256("master shielded root 1")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot1 = uint256(keccak256("master wormhole root 1")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), masterShieldedRoot1, masterWormholeRoot1, 100, 1000, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        uint256 masterShieldedRoot2 = uint256(keccak256("master shielded root 2")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot2 = uint256(keccak256("master wormhole root 2")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), masterShieldedRoot2, masterWormholeRoot2, 101, 1000, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        // Both old and new roots should be valid
        assertTrue(shieldedPool.isMasterShieldedRoot(bytes32(masterShieldedRoot1)), "First shielded root should still be valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(bytes32(masterWormholeRoot1)), "First wormhole root should still be valid");
        assertTrue(shieldedPool.isMasterShieldedRoot(bytes32(masterShieldedRoot2)), "Second shielded root should be valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(bytes32(masterWormholeRoot2)), "Second wormhole root should be valid");
    }

    function test_updateMasterTrees_branchChain_revert_notNewMasterTreeEvent() public {
        uint256 masterShieldedRoot1 = uint256(keccak256("master shielded root 1")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot1 = uint256(keccak256("master wormhole root 1")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), masterShieldedRoot1, masterWormholeRoot1, 100, 1000, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        uint256 masterShieldedRoot2 = uint256(keccak256("master shielded root 2")) % SNARK_SCALAR_FIELD;
        uint256 masterWormholeRoot2 = uint256(keccak256("master wormhole root 2")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), masterShieldedRoot2, masterWormholeRoot2, 100, 1000, true);

        vm.expectRevert("Master tree event is not new");
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        // Old root should be valid, new root should be invalid
        assertTrue(shieldedPool.isMasterShieldedRoot(bytes32(masterShieldedRoot1)), "First shielded root should still be valid");
        assertTrue(shieldedPool.isMasterWormholeRoot(bytes32(masterWormholeRoot1)), "First wormhole root should still be valid");
        assertFalse(shieldedPool.isMasterShieldedRoot(bytes32(masterShieldedRoot2)), "Second shielded root should be invalid");
        assertFalse(shieldedPool.isMasterWormholeRoot(bytes32(masterWormholeRoot2)), "Second wormhole root should be invalid");
    }

    // -------------------------------------------------------------------
    // Integration: branch chain receives roots and uses them
    // -------------------------------------------------------------------

    function test_updateMasterTrees_branchChain_rootsUsableForShieldedTransfer() public {
        // Simulate receiving master tree update on branch chain
        uint256 newMasterShieldedRoot = uint256(keccak256("new master shielded root")) % SNARK_SCALAR_FIELD;
        uint256 newMasterWormholeRoot = uint256(keccak256("new master wormhole root")) % SNARK_SCALAR_FIELD;
        _setupMasterEventProof(uint32(masterChainId), address(shieldedPool), newMasterShieldedRoot, newMasterWormholeRoot, 100, 1000, true);
        shieldedPool.updateMasterTrees(abi.encodePacked("proof"));

        // Use the received roots in a shielded transfer
        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = keccak256(abi.encodePacked("nullifier 1"));
        nullifiers[1] = keccak256(abi.encodePacked("nullifier 2"));
        uint256[] memory commitments = new uint256[](2);
        commitments[0] = uint256(keccak256(abi.encodePacked("commitment 1"))) % SNARK_SCALAR_FIELD;
        commitments[1] = uint256(keccak256(abi.encodePacked("commitment 2"))) % SNARK_SCALAR_FIELD;

        ShieldedPool.ShieldedTx memory shieldedTx = ShieldedPool.ShieldedTx({
            chainId: uint64(block.chainid),
            wormholeRoot: bytes32(newMasterWormholeRoot),
            wormholeNullifier: keccak256(abi.encodePacked("wormhole nullifier")),
            shieldedRoot: bytes32(newMasterShieldedRoot),
            nullifiers: nullifiers,
            commitments: commitments,
            withdrawals: new ShieldedPool.Withdrawal[](0)
        });

        shieldedPool.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));

        assertTrue(shieldedPool.wormholeNullifierUsed(shieldedTx.wormholeNullifier), "Wormhole nullifier should be used");
        assertTrue(shieldedPool.nullifierUsed(nullifiers[0]), "Nullifier 1 should be used");
        assertTrue(shieldedPool.nullifierUsed(nullifiers[1]), "Nullifier 2 should be used");

        // Branch shielded tree should be updated with new commitments
        (bytes32 branchShieldedRoot, uint256 branchSize,) = shieldedPool.branchShieldedTree(0);
        bytes32 expectedBranchRoot = bytes32(poseidon2.hash_2(commitments[0], commitments[1]));
        assertEq(branchShieldedRoot, expectedBranchRoot, "Branch shielded root should be hash of commitments");
        assertEq(branchSize, 2, "Branch shielded tree should have 2 entries");
    }

    // -------------------------------------------------------------------
    // Master chain: appendWormholeLeaf updates both branch and master trees
    // -------------------------------------------------------------------

    function test_appendWormholeLeaf_masterChain_updatesMasterWormholeTree() public {
        vm.chainId(masterChainId);

        address from = makeAddr("from");
        address to = makeAddr("to");
        _dealWormholeTokens(from, 100e18);
        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        (bytes32 masterWormholeRootBefore, uint256 sizeBefore,) = shieldedPool.masterWormholeTree(0);
        assertEq(sizeBefore, 0, "Master wormhole tree should start empty");

        vm.prank(screener);
        shieldedPool.appendWormholeLeaf(1, true);

        (bytes32 masterWormholeRootAfter, uint256 sizeAfter,) = shieldedPool.masterWormholeTree(0);
        assertEq(sizeAfter, 1, "Master wormhole tree should have 1 leaf after append on master chain");
        assertTrue(masterWormholeRootAfter != masterWormholeRootBefore, "Master wormhole root should change");
        assertTrue(shieldedPool.isMasterWormholeRoot(masterWormholeRootAfter), "New master wormhole root should be valid");

        // Branch tree should also be updated
        (bytes32 branchWormholeRoot, uint256 branchSize,) = shieldedPool.branchWormholeTree(0);
        assertEq(branchSize, 1, "Branch wormhole tree should have 1 leaf");
        // On master chain with single leaf, master root equals branch root
        assertEq(uint256(masterWormholeRootAfter), uint256(branchWormholeRoot), "Master root should equal branch root for single leaf");
    }

    function test_appendManyWormholeLeaves_masterChain_updatesMasterWormholeTree() public {
        vm.chainId(masterChainId);

        address from = makeAddr("from");
        address to = makeAddr("to");
        _dealWormholeTokens(from, 100e18);
        vm.prank(from);
        wormholeVault.transfer(to, 100e18);

        IShieldedPool.WormholePreCommitment[] memory nodes = new IShieldedPool.WormholePreCommitment[](2);
        nodes[0] = IShieldedPool.WormholePreCommitment({entryId: 0, approved: false});
        nodes[1] = IShieldedPool.WormholePreCommitment({entryId: 1, approved: true});

        vm.prank(screener);
        shieldedPool.appendManyWormholeLeaves(nodes);

        (bytes32 masterWormholeRoot, uint256 masterSize,) = shieldedPool.masterWormholeTree(0);
        (bytes32 branchWormholeRoot, uint256 branchSize,) = shieldedPool.branchWormholeTree(0);

        assertEq(masterSize, 1, "Master wormhole tree should have 1 leaf (the branch root)");
        assertEq(branchSize, 2, "Branch wormhole tree should have 2 leaves");
        assertTrue(shieldedPool.isMasterWormholeRoot(masterWormholeRoot), "Master wormhole root should be valid");
        // Master root equals branch root (single leaf in master tree)
        assertEq(uint256(masterWormholeRoot), uint256(branchWormholeRoot), "Master root should equal branch root");
    }

    // -------------------------------------------------------------------
    // Master chain: shieldedTransfer updates both branch and master trees
    // -------------------------------------------------------------------

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

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = keccak256(abi.encodePacked("nullifier 1"));
        nullifiers[1] = keccak256(abi.encodePacked("nullifier 2"));
        uint256[] memory commitments = new uint256[](2);
        commitments[0] = uint256(keccak256(abi.encodePacked("commitment 1"))) % SNARK_SCALAR_FIELD;
        commitments[1] = uint256(keccak256(abi.encodePacked("commitment 2"))) % SNARK_SCALAR_FIELD;

        ShieldedPool.ShieldedTx memory shieldedTx = ShieldedPool.ShieldedTx({
            chainId: masterChainId,
            wormholeRoot: wormholeRoot,
            wormholeNullifier: keccak256(abi.encodePacked("wormhole nullifier")),
            shieldedRoot: shieldedRoot,
            nullifiers: nullifiers,
            commitments: commitments,
            withdrawals: new ShieldedPool.Withdrawal[](0)
        });

        shieldedPool.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));

        // Master shielded tree should be updated on master chain
        (bytes32 masterShieldedRootAfter, uint256 masterShieldedSize,) = shieldedPool.masterShieldedTree(0);
        assertTrue(masterShieldedRootAfter != shieldedRoot, "Master shielded root should change after transfer on master chain");
        assertEq(masterShieldedSize, 1, "Master shielded tree should have 1 leaf (the branch shielded root)");
        assertTrue(shieldedPool.isMasterShieldedRoot(masterShieldedRootAfter), "New master shielded root should be valid");

        // Branch shielded tree should also be updated
        (bytes32 branchShieldedRoot, uint256 branchSize,) = shieldedPool.branchShieldedTree(0);
        bytes32 expectedBranchRoot = bytes32(poseidon2.hash_2(commitments[0], commitments[1]));
        assertEq(branchShieldedRoot, expectedBranchRoot, "Branch shielded root should be hash of commitments");
        assertEq(branchSize, 2, "Branch shielded tree should have 2 commitment leaves");
        // Master root equals branch root (single leaf in master tree)
        assertEq(uint256(masterShieldedRootAfter), uint256(branchShieldedRoot), "Master root should equal branch root for single leaf");
    }

    function test_shieldedTransfer_masterChain_emitsMasterTreesUpdated() public {
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

        bytes32[] memory nullifiers = new bytes32[](2);
        nullifiers[0] = keccak256(abi.encodePacked("nullifier 1"));
        nullifiers[1] = keccak256(abi.encodePacked("nullifier 2"));
        uint256[] memory commitments = new uint256[](2);
        commitments[0] = uint256(keccak256(abi.encodePacked("commitment 1"))) % SNARK_SCALAR_FIELD;
        commitments[1] = uint256(keccak256(abi.encodePacked("commitment 2"))) % SNARK_SCALAR_FIELD;

        ShieldedPool.ShieldedTx memory shieldedTx = ShieldedPool.ShieldedTx({
            chainId: masterChainId,
            wormholeRoot: wormholeRoot,
            wormholeNullifier: keccak256(abi.encodePacked("wormhole nullifier")),
            shieldedRoot: shieldedRoot,
            nullifiers: nullifiers,
            commitments: commitments,
            withdrawals: new ShieldedPool.Withdrawal[](0)
        });

        // Compute expected master shielded root (branch root is hash of 2 commitments, and it's the only master leaf)
        uint256 expectedBranchShieldedRoot = poseidon2.hash_2(commitments[0], commitments[1]);

        vm.expectEmit(true, true, false, true, address(shieldedPool));
        emit ShieldedPool.MasterTreesUpdated(0, 0, expectedBranchShieldedRoot, uint256(wormholeRoot), block.number, block.timestamp);
        shieldedPool.shieldedTransfer(shieldedTx, abi.encodePacked("mock zk proof"));
    }
}