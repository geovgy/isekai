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

    function _dealWormholeTokens(address to, uint256 shares) internal {
        uint256 amount = vault.convertToAssets(shares);
        underlying.mint(to, amount);
        vm.startPrank(to);
        underlying.approve(address(wormholeVault), amount);
        wormholeVault.deposit(amount, to);
        vm.stopPrank();
    }

    function _getWormholeCommitment(address from, address to, bytes32 assetId, uint256 amount, bool approved) internal view returns (uint256) {
        return poseidon2.hash_5(approved ? 1 : 0, uint256(uint160(from)), uint256(uint160(to)), uint256(assetId), amount);
    }

    function _getAssetId(address asset, uint256 id) internal view returns (bytes32) {
        return bytes32(poseidon2.hash_2(uint256(uint160(asset)), id));
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
        bytes memory initData = abi.encodePacked(address(underlying), address(vault));
        vm.prank(address(shieldedPool));
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

        bytes32 assetId = _getAssetId(address(wormholeVault), 0);
        uint256 expectedCommitment = _getWormholeCommitment(from, to, assetId, 100e18, true);

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(1, expectedCommitment, 0, 0, assetId, from, to, 100e18, true);
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

        bytes32 assetId = _getAssetId(address(wormholeVault), 0);

        IShieldedPool.WormholePreCommitment[] memory nodes = new IShieldedPool.WormholePreCommitment[](2);
        nodes[0] = IShieldedPool.WormholePreCommitment({entryId: 0, approved: false});
        nodes[1] = IShieldedPool.WormholePreCommitment({entryId: 1, approved: true});

        uint256[2] memory expectedCommitments = [
            _getWormholeCommitment(address(0), from, assetId, 100e18, nodes[0].approved),
            _getWormholeCommitment(from, to, assetId, 100e18, nodes[1].approved)
        ];

        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(nodes[0].entryId, expectedCommitments[0], 0, 0, assetId, address(0), from, 100e18, nodes[0].approved);
        emit ShieldedPool.WormholeCommitment(nodes[1].entryId, expectedCommitments[1], 0, 1, assetId, from, to, 100e18, nodes[1].approved);
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

        bytes32 assetId = _getAssetId(address(wormholeVault), 0);
        uint256 expectedCommitment = _getWormholeCommitment(from, to, assetId, 100e18, false);

        // Should succeed
        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(1, expectedCommitment, 0, 0, assetId, from, to, 100e18, false);
        vm.prank(from);
        shieldedPool.initiateRagequit(1);
        
        // Should revert since entry is already committed
        vm.expectRevert("ShieldedPool: entry is already committed in wormhole tree");
        vm.prank(from);
        shieldedPool.initiateRagequit(1);

        expectedCommitment = _getWormholeCommitment(address(0), from, assetId, 100e18, false);

        // Can still append leafs of older entries skipped
        vm.expectEmit(address(shieldedPool));
        emit ShieldedPool.WormholeCommitment(0, expectedCommitment, 0, 1, assetId, address(0), from, 100e18, false);
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
            chainId: 1,
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
            chainId: 1,
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
}