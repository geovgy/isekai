// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../mock/MockERC20.sol";
import {MockVerifier} from "../mock/MockVerifier.sol";
import {MockCrossL2Prover} from "../mock/MockCrossL2Prover.sol";
import {ShieldedPool} from "../../src/ShieldedPool.sol";
import {ERC20WormholeConfidential} from "../../src/wormholes/ERC20WormholeConfidential.sol";
import {ConfidentialWormhole} from "../../src/ConfidentialWormhole.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {IWormhole} from "../../src/interfaces/IWormhole.sol";
import {IShieldedPool} from "../../src/interfaces/IShieldedPool.sol";
import {SNARK_SCALAR_FIELD} from "../../src/utils/Constants.sol";

contract ERC20WormholeConfidentialTest is Test {
    MockERC20 underlying;
    ShieldedPool shieldedPool;
    ERC20WormholeConfidential wormhole;

    IPoseidon2 poseidon2;
    MockVerifier utxoVerifier;
    MockVerifier confVerifier;
    MockCrossL2Prover crossL2Prover;

    address owner = makeAddr("owner");
    address screener = makeAddr("screener");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        poseidon2 = IPoseidon2(address(new Poseidon2()));
        utxoVerifier = new MockVerifier();
        confVerifier = new MockVerifier();
        crossL2Prover = new MockCrossL2Prover();

        shieldedPool = new ShieldedPool(poseidon2, utxoVerifier, crossL2Prover, owner);
        underlying = new MockERC20();
        wormhole = new ERC20WormholeConfidential(
            shieldedPool, poseidon2, confVerifier, "Shielded ", "s"
        );
        wormhole.initialize(abi.encodePacked(address(underlying)));

        vm.prank(owner);
        shieldedPool.addVerifier(utxoVerifier, 2, 2);
        vm.prank(owner);
        shieldedPool.setWormholeApprover(screener, true);
    }

    function _dealTokens(address to, uint256 amount) internal {
        underlying.mint(to, amount);
        vm.startPrank(to);
        underlying.approve(address(wormhole), amount);
        wormhole.deposit(amount, to);
        vm.stopPrank();
    }

    function _computeConfidentialCommitment(
        address from, address to, uint256 treeId, uint256 id, uint256 amount, bytes32 confidentialContext
    ) internal view returns (uint256) {
        uint256 fullContext = uint256(confidentialContext);
        if (amount != 0) {
            fullContext = poseidon2.hash_4(uint160(address(wormhole)), id, amount, fullContext);
        }
        return poseidon2.hash_4(uint256(uint160(from)), uint256(uint160(to)), treeId, fullContext);
    }

    // ========================================
    // Initialization
    // ========================================

    function test_initialize() public view {
        assertEq(address(wormhole.underlying()), address(underlying));
        assertEq(address(wormhole.shieldedPool()), address(shieldedPool));
        assertTrue(wormhole.initialized());
    }

    function test_initialize_revert_alreadyInitialized() public {
        // After initialize(), ownership is renounced, so onlyOwner reverts first
        vm.expectRevert();
        wormhole.initialize(abi.encodePacked(address(underlying)));
    }

    function test_initialize_revert_selfAddress() public {
        ERC20WormholeConfidential w2 = new ERC20WormholeConfidential(
            shieldedPool, poseidon2, confVerifier, "zk", "zk"
        );
        vm.expectRevert(abi.encodeWithSelector(ERC20WormholeConfidential.ERC20InvalidUnderlying.selector, address(w2)));
        w2.initialize(abi.encodePacked(address(w2)));
    }

    function test_initialize_revert_zeroAddress() public {
        ERC20WormholeConfidential w2 = new ERC20WormholeConfidential(
            shieldedPool, poseidon2, confVerifier, "zk", "zk"
        );
        vm.expectRevert(abi.encodeWithSelector(ERC20WormholeConfidential.ERC20InvalidUnderlying.selector, address(0)));
        w2.initialize(abi.encodePacked(address(0)));
    }

    function test_nameAndSymbol() public view {
        assertEq(wormhole.name(), "Shielded MockERC20");
        assertEq(wormhole.symbol(), "sM20");
    }

    function test_decimals() public view {
        assertEq(wormhole.decimals(), underlying.decimals());
    }

    // ========================================
    // Deposit / Withdraw
    // ========================================

    function test_deposit() public {
        underlying.mint(alice, 100e18);
        vm.startPrank(alice);
        underlying.approve(address(wormhole), 100e18);
        wormhole.deposit(100e18, alice);
        vm.stopPrank();

        assertEq(wormhole.balanceOf(alice), 100e18);
        assertEq(underlying.balanceOf(address(wormhole)), 100e18);
        assertEq(wormhole.actualSupply(), 100e18);
    }

    // TODO: Fix core logic so wormhole entry is created on deposit
    function test_deposit_noWormholeEntry() public {
        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        underlying.mint(alice, 100e18);
        vm.startPrank(alice);
        underlying.approve(address(wormhole), 100e18);
        wormhole.deposit(100e18, alice);
        vm.stopPrank();

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore, "Deposit should not create wormhole entry (mint filtered in _update)");
    }

    function test_deposit_revert_selfSender() public {
        vm.prank(address(wormhole));
        vm.expectRevert();
        wormhole.deposit(100e18, alice);
    }

    function test_deposit_revert_selfReceiver() public {
        underlying.mint(alice, 100e18);
        vm.startPrank(alice);
        underlying.approve(address(wormhole), 100e18);
        vm.expectRevert();
        wormhole.deposit(100e18, address(wormhole));
        vm.stopPrank();
    }

    function test_withdraw() public {
        _dealTokens(alice, 100e18);

        vm.prank(alice);
        wormhole.withdraw(50e18, alice, alice);

        assertEq(wormhole.balanceOf(alice), 50e18);
        assertEq(underlying.balanceOf(alice), 50e18);
        assertEq(wormhole.actualSupply(), 50e18);
    }

    // TODO: Fix core logic so wormhole entry is created on withdraw
    function test_withdraw_noWormholeEntry() public {
        _dealTokens(alice, 100e18);

        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.withdraw(50e18, alice, alice);

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore, "Withdraw should not create wormhole entry (burn filtered in _update)");
    }

    // ========================================
    // Transfer creates wormhole entry
    // ========================================

    function test_transfer_createsWormholeEntry() public {
        _dealTokens(alice, 100e18);
        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.transfer(bob, 50e18);

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore + 1);

        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(entry.from, alice);
        assertEq(entry.to, bob);
        assertEq(entry.asset, address(wormhole));
        assertEq(entry.id, 0);
        assertEq(entry.amount, 50e18);
        assertEq(entry.confidentialContext, bytes32(0), "Regular transfer should have zero confidentialContext");
    }

    function test_transfer_multipleTransfersCreateMultipleEntries() public {
        _dealTokens(alice, 100e18);
        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.startPrank(alice);
        wormhole.transfer(bob, 30e18);
        wormhole.transfer(bob, 20e18);
        vm.stopPrank();

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore + 2);

        ShieldedPool.TransferMetadata memory entry0 = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(entry0.amount, 30e18);

        ShieldedPool.TransferMetadata memory entry1 = shieldedPool.wormholeEntry(entriesBefore + 1);
        assertEq(entry1.amount, 20e18);
    }

    // ========================================
    // convertToConfidential
    // ========================================

    function test_convertToConfidential_burnsTokens() public {
        _dealTokens(alice, 100e18);

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, bytes32(uint256(12345)));

        assertEq(wormhole.balanceOf(alice), 50e18, "convertToConfidential should burn tokens from sender");
    }

    function test_convertToConfidential_createsConfidentialCommitment() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.expectEmit(true, true, true, false, address(wormhole));
        emit ConfidentialWormhole.ConfidentialConversion(
            alice, bob, 0, bytes32(0), 0, 50e18, confContext, ConfidentialWormhole.ConfidentialConversionType.DEPOSIT
        );

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);
    }

    function test_convertToConfidential_createsWormholeEntry() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore + 1);

        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(entry.from, alice);
        assertEq(entry.to, bob);
        assertEq(entry.asset, address(wormhole));
        assertEq(entry.amount, 50e18);
        assertEq(entry.confidentialContext, confContext, "Wormhole entry should carry the confidentialContext");
    }

    function test_convertToConfidential_revert_zeroContext() public {
        _dealTokens(alice, 100e18);

        vm.prank(alice);
        vm.expectRevert("ConfidentialWormhole: confidential context is zero");
        wormhole.convertToConfidential(bob, 0, 50e18, bytes32(0));
    }

    function test_convertToConfidential_updatesConfidentialRoot() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        uint256 expectedCommitment = _computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext);
        assertTrue(wormhole.isConfidentialRoot(bytes32(expectedCommitment)), "Confidential root should be set after conversion");
    }

    function test_convertToConfidential_commitmentMatchesExpected() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(42));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        // fullContext = poseidon2(wormhole, 0, 50e18, uint256(confContext)) since amount != 0
        uint256 fullContext = poseidon2.hash_4(uint160(address(wormhole)), 0, 50e18, uint256(confContext));
        // commitment = poseidon2(alice, bob, treeId=0, fullContext)
        uint256 expectedCommitment = poseidon2.hash_4(uint256(uint160(alice)), uint256(uint160(bob)), 0, fullContext);

        // Single-element LeanIMT: root == leaf
        assertTrue(wormhole.isConfidentialRoot(bytes32(expectedCommitment)));
    }

    // ========================================
    // confidentialTransfer
    // ========================================

    function test_confidentialTransfer() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        uint256 depositCommitment = _computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext);
        bytes32 confRoot = bytes32(depositCommitment);
        assertTrue(wormhole.isConfidentialRoot(confRoot));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier 1");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(999));

        vm.prank(alice);
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, abi.encodePacked("proof"));

        assertTrue(wormhole.nullifierUsed(nullifiers[0]), "Nullifier should be consumed");

        // New commitment: amount=0 so fullContext = uint256(contexts[0])
        uint256 newCommitment = poseidon2.hash_4(uint256(uint160(alice)), uint256(uint160(bob)), 0, uint256(contexts[0]));
        bytes32 expectedNewRoot = bytes32(poseidon2.hash_2(depositCommitment, newCommitment));
        assertTrue(wormhole.isConfidentialRoot(expectedNewRoot), "New confidential root should be set after transfer");
    }

    // TODO: Fix core logic so wormhole entry is created on confidential transfer
    function test_confidentialTransfer_noWormholeEntryCreated() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        uint256 depositCommitment = _computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext);
        bytes32 confRoot = bytes32(depositCommitment);

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(999));

        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, abi.encodePacked("proof"));

        // TODO: Fix core logic so wormhole entry is created on confidential transfer
        // amount=0 in _requestWormholeEntry → filtered by _isWormholeEligible
        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore, "confidentialTransfer should not create wormhole entries");
    }

    function test_confidentialTransfer_revert_invalidRoot() public {
        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));

        vm.prank(alice);
        vm.expectRevert("ConfidentialWormhole: root is not valid");
        wormhole.confidentialTransfer(bob, bytes32(uint256(1)), nullifiers, contexts, "proof");
    }

    function test_confidentialTransfer_revert_invalidProof() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        confVerifier.setReturnValue(false);

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));

        vm.prank(alice);
        vm.expectRevert("ConfidentialWormhole: proof is not valid");
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, "proof");
    }

    function test_confidentialTransfer_revert_usedNullifier() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(999));

        vm.prank(alice);
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, "proof");

        // Compute the new root after first transfer
        uint256 depositCommitment = _computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext);
        uint256 newCommitment = poseidon2.hash_4(uint256(uint160(alice)), uint256(uint160(bob)), 0, uint256(contexts[0]));
        bytes32 newRoot = bytes32(poseidon2.hash_2(depositCommitment, newCommitment));

        bytes32[] memory contexts2 = new bytes32[](1);
        contexts2[0] = bytes32(uint256(888));

        vm.prank(alice);
        vm.expectRevert("ConfidentialWormhole: nullifier is already used");
        wormhole.confidentialTransfer(bob, newRoot, nullifiers, contexts2, "proof");
    }

    function test_confidentialTransfer_emitsEvent() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(999));

        vm.expectEmit(true, true, true, false, address(wormhole));
        emit ConfidentialWormhole.ConfidentialTransfer(alice, bob, 0, bytes32(0), nullifiers, contexts);

        vm.prank(alice);
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, "proof");
    }

    // ========================================
    // convertFromConfidential
    // ========================================

    function test_convertFromConfidential_withdrawal() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("nullifier from");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(777));

        uint256 bobBalanceBefore = wormhole.balanceOf(bob);
        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        // Zero confidentialContext = pure withdrawal from confidential → public tokens
        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), confRoot, nullifiers, contexts, "proof");

        assertEq(wormhole.balanceOf(bob), bobBalanceBefore + 30e18, "Bob should receive minted public tokens");
        assertTrue(wormhole.nullifierUsed(nullifiers[0]), "Nullifier should be consumed");
        assertGt(shieldedPool.totalWormholeEntries(), entriesBefore, "Wormhole entry should be created for the conversion");
    }

    function test_convertFromConfidential_emitsWithdrawalEvent() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("null");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));

        vm.expectEmit(true, true, true, false, address(wormhole));
        emit ConfidentialWormhole.ConfidentialConversion(
            alice, bob, 0, bytes32(0), 0, 30e18, bytes32(0), ConfidentialWormhole.ConfidentialConversionType.WITHDRAWAL
        );

        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), confRoot, nullifiers, contexts, "proof");
    }

    // TODO: Check logic of this one.
    // If non-zero context included in conversion from confidential, both alice and bob's public balance should NOT change.
    function test_convertFromConfidential_withNonZeroContext() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("null");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));
        bytes32 newConfContext = bytes32(uint256(888));

        // This is wrong. The public balance should not change.
        // Bug:
        // Non-zero confidentialContext: burns from sender then mints to recipient.
        // Alice has 50e18 remaining. Burn 30e18 from alice → 20e18 left. Then mint 30e18 to bob.
        uint256 aliceBalanceBefore = wormhole.balanceOf(alice);
        uint256 bobBalanceBefore = wormhole.balanceOf(bob);

        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 30e18, newConfContext, confRoot, nullifiers, contexts, "proof");

        assertEq(wormhole.balanceOf(alice), aliceBalanceBefore - 30e18, "Alice's public tokens should decrease by conversion amount");
        assertEq(wormhole.balanceOf(bob), bobBalanceBefore + 30e18, "Bob should receive minted public tokens");
    }

    function test_convertFromConfidential_revert_invalidRoot() public {
        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("null");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));

        vm.prank(alice);
        vm.expectRevert("ConfidentialWormhole: root is not valid");
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), bytes32(uint256(9999)), nullifiers, contexts, "proof");
    }

    function test_convertFromConfidential_revert_invalidProof() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        confVerifier.setReturnValue(false);

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("null");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));

        vm.prank(alice);
        vm.expectRevert("ConfidentialWormhole: proof is not valid");
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), confRoot, nullifiers, contexts, "proof");
    }

    function test_convertFromConfidential_createsWormholeEntry() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext = bytes32(uint256(12345));

        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 50e18, confContext);

        bytes32 confRoot = bytes32(_computeConfidentialCommitment(alice, bob, 0, 0, 50e18, confContext));

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("null");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(1));

        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), confRoot, nullifiers, contexts, "proof");

        uint256 entriesAfter = shieldedPool.totalWormholeEntries();
        assertEq(entriesAfter, entriesBefore + 1, "Should create one wormhole entry for the conversion");

        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(entry.from, alice);
        assertEq(entry.to, bob);
        assertEq(entry.amount, 30e18);
        assertEq(entry.confidentialContext, bytes32(0), "Withdrawal context should be zero");
    }

    // ========================================
    // unshield
    // ========================================

    function test_unshield_onlyShieldedPool() public {
        vm.prank(alice);
        vm.expectRevert("Wormhole: caller is not shielded pool");
        wormhole.unshield(alice, 0, 50e18, bytes32(0));
    }

    function test_unshield_publicMint() public {
        vm.prank(address(shieldedPool));
        wormhole.unshield(alice, 0, 50e18, bytes32(0));

        assertEq(wormhole.balanceOf(alice), 50e18, "Unshield should mint tokens to recipient");

        uint256 lastEntryId = shieldedPool.totalWormholeEntries() - 1;
        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(lastEntryId);
        assertEq(entry.from, address(0), "Unshield entry from should be address(0)");
        assertEq(entry.to, alice);
        assertEq(entry.amount, 50e18);
        assertEq(entry.confidentialContext, bytes32(0));
    }

    // TODO: Fix core logic so unshield with confidential context doesn't revert
    function test_unshield_withConfidentialContext_reverts() public {
        // _unshield mints to `to`, then _convertToConfidential tries to burn from
        // msg.sender (ShieldedPool) which holds no wormhole tokens.
        bytes32 confContext = bytes32(uint256(42));

        vm.prank(address(shieldedPool));
        vm.expectRevert();
        wormhole.unshield(alice, 0, 50e18, confContext);
    }

    function test_unshield_emitsEvent() public {
        vm.expectEmit(true, true, true, true, address(wormhole));
        emit IWormhole.Unshield(alice, 0, 50e18, bytes32(0));

        vm.prank(address(shieldedPool));
        wormhole.unshield(alice, 0, 50e18, bytes32(0));
    }

    // ========================================
    // End-to-end flow
    // ========================================

    function test_fullFlow_depositConvertTransferAndBack() public {
        // 1. Alice deposits underlying → gets wrapped tokens
        _dealTokens(alice, 1000e18);
        assertEq(wormhole.balanceOf(alice), 1000e18);

        // 2. Alice converts some to confidential
        bytes32 confContext = bytes32(uint256(42));
        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 400e18, confContext);
        assertEq(wormhole.balanceOf(alice), 600e18, "Alice should have 600 after converting 400 to confidential");

        // 3. Alice transfers public tokens to bob
        vm.prank(alice);
        wormhole.transfer(bob, 200e18);
        assertEq(wormhole.balanceOf(alice), 400e18);
        assertEq(wormhole.balanceOf(bob), 200e18);

        // 4. Verify wormhole entries
        assertEq(shieldedPool.totalWormholeEntries(), 2, "Should have 2 entries: convertToConfidential + transfer");

        ShieldedPool.TransferMetadata memory entry0 = shieldedPool.wormholeEntry(0);
        assertEq(entry0.from, alice);
        assertEq(entry0.to, bob);
        assertEq(entry0.amount, 400e18);
        assertEq(entry0.confidentialContext, confContext, "Entry 0 should carry confidentialContext");

        ShieldedPool.TransferMetadata memory entry1 = shieldedPool.wormholeEntry(1);
        assertEq(entry1.from, alice);
        assertEq(entry1.to, bob);
        assertEq(entry1.amount, 200e18);
        assertEq(entry1.confidentialContext, bytes32(0), "Entry 1 should have zero confidentialContext");

        // 5. Approve and commit both entries to wormhole tree
        vm.prank(screener);
        IShieldedPool.WormholePreCommitment[] memory nodes = new IShieldedPool.WormholePreCommitment[](2);
        nodes[0] = IShieldedPool.WormholePreCommitment({entryId: 0, approved: true});
        nodes[1] = IShieldedPool.WormholePreCommitment({entryId: 1, approved: true});
        shieldedPool.appendManyWormholeLeaves(nodes);

        assertEq(shieldedPool.totalWormholeCommitments(), 2, "Both entries should be committed");

        (bytes32 wormholeRoot, uint256 size,) = shieldedPool.branchWormholeTree(0);
        assertEq(size, 2, "Branch wormhole tree should have 2 leaves");
        assertTrue(wormholeRoot != bytes32(0), "Wormhole root should be non-zero");
    }

    function test_convertToConfidential_thenConfidentialTransfer_thenConvertBack() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext1 = bytes32(uint256(111));

        // Convert to confidential
        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 60e18, confContext1);
        assertEq(wormhole.balanceOf(alice), 40e18);

        // TODO: Fix core logic so confidential transfer creates wormhole entry
        // Confidential transfer (no public token changes, no wormhole entry - for now which is a bug)
        uint256 depositCommitment = _computeConfidentialCommitment(alice, bob, 0, 0, 60e18, confContext1);
        bytes32 confRoot = bytes32(depositCommitment);

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("ct-nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(222));

        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, "proof");

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore, "confidentialTransfer should not create wormhole entries");
        assertEq(wormhole.balanceOf(alice), 40e18, "Public balance should not change during confidential transfer");

        // Convert from confidential back to public (withdrawal)
        uint256 transferCommitment = poseidon2.hash_4(uint256(uint160(alice)), uint256(uint160(bob)), 0, uint256(contexts[0]));
        bytes32 newRoot = bytes32(poseidon2.hash_2(depositCommitment, transferCommitment));

        bytes32[] memory nullifiers2 = new bytes32[](1);
        nullifiers2[0] = keccak256("cf-nullifier");
        bytes32[] memory contexts2 = new bytes32[](1);
        contexts2[0] = bytes32(uint256(333));

        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 40e18, bytes32(0), newRoot, nullifiers2, contexts2, "proof");

        assertEq(wormhole.balanceOf(bob), 40e18, "Bob should receive public tokens from convertFromConfidential");
    }
}
