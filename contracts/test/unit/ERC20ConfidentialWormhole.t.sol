// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../mock/MockERC20.sol";
import {MockVerifier} from "../mock/MockVerifier.sol";
import {MockCrossL2Prover} from "../mock/MockCrossL2Prover.sol";
import {ShieldedPool} from "../../src/ShieldedPool.sol";
import {ERC20ConfidentialWormhole} from "../../src/wormholes/ERC20ConfidentialWormhole.sol";
import {ConfidentialWormhole} from "../../src/ConfidentialWormhole.sol";
import {IPoseidon2} from "poseidon2-evm/IPoseidon2.sol";
import {Poseidon2Yul_BN254 as Poseidon2} from "poseidon2-evm/bn254/yul/Poseidon2Yul.sol";
import {IVerifier} from "../../src/interfaces/IVerifier.sol";
import {IWormhole} from "../../src/interfaces/IWormhole.sol";
import {IShieldedPool} from "../../src/interfaces/IShieldedPool.sol";
import {SNARK_SCALAR_FIELD} from "../../src/utils/Constants.sol";

contract ERC20ConfidentialWormholeTest is Test {
    MockERC20 underlying;
    ShieldedPool shieldedPool;
    ERC20ConfidentialWormhole wormhole;

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
        wormhole = new ERC20ConfidentialWormhole(
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
        ERC20ConfidentialWormhole w2 = new ERC20ConfidentialWormhole(
            shieldedPool, poseidon2, confVerifier, "zk", "zk"
        );
        vm.expectRevert(abi.encodeWithSelector(ERC20ConfidentialWormhole.ERC20InvalidUnderlying.selector, address(w2)));
        w2.initialize(abi.encodePacked(address(w2)));
    }

    function test_initialize_revert_zeroAddress() public {
        ERC20ConfidentialWormhole w2 = new ERC20ConfidentialWormhole(
            shieldedPool, poseidon2, confVerifier, "zk", "zk"
        );
        vm.expectRevert(abi.encodeWithSelector(ERC20ConfidentialWormhole.ERC20InvalidUnderlying.selector, address(0)));
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

    function test_deposit_createsWormholeEntry() public {
        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        underlying.mint(alice, 100e18);
        vm.startPrank(alice);
        underlying.approve(address(wormhole), 100e18);
        wormhole.deposit(100e18, alice);
        vm.stopPrank();

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore + 1, "Deposit should create one wormhole entry");

        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(entry.from, address(0), "Deposit entry from should be address(0)");
        assertEq(entry.to, alice, "Deposit entry to should be the receiver");
        assertEq(entry.asset, address(wormhole), "Deposit entry asset should be wormhole");
        assertEq(entry.amount, 100e18, "Deposit entry amount should match");
        assertEq(entry.confidentialContext, bytes32(0), "Deposit entry context should be zero");
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

    function test_confidentialTransfer_createsWormholeEntries() public {
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

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore + 1, "confidentialTransfer should create one wormhole entry per context");

        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(entry.from, alice, "Entry from should be the sender");
        assertEq(entry.to, bob, "Entry to should be the recipient");
        assertEq(entry.amount, 0, "Entry amount should be 0 for confidential transfer");
        assertEq(entry.confidentialContext, contexts[0], "Entry should carry the confidentialContext");
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

        uint256 aliceBalanceBefore = wormhole.balanceOf(alice);
        uint256 bobBalanceBefore = wormhole.balanceOf(bob);
        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        // convertFromConfidential uses WITHDRAWAL — mints public tokens to recipient
        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), confRoot, nullifiers, contexts, "proof");

        assertEq(wormhole.balanceOf(alice), aliceBalanceBefore, "Alice's public balance should not change");
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

        // Non-zero confidentialContext: WITHDRAWAL calls _mintWithContext which creates
        // a confidential commitment via _convertToConfidential(address(0), bob, ...).
        // No public token changes for either party.
        uint256 aliceBalanceBefore = wormhole.balanceOf(alice);
        uint256 bobBalanceBefore = wormhole.balanceOf(bob);

        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 30e18, newConfContext, confRoot, nullifiers, contexts, "proof");

        assertEq(wormhole.balanceOf(alice), aliceBalanceBefore, "Alice's public balance should not change");
        assertEq(wormhole.balanceOf(bob), bobBalanceBefore, "Bob's public balance should not change");
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

        vm.prank(bob);
        wormhole.convertFromConfidential(bob, 0, 30e18, bytes32(0), confRoot, nullifiers, contexts, "proof");

        uint256 entriesAfter = shieldedPool.totalWormholeEntries();
        // Inner loop: 1 entry (amount=0, context=contexts[0])
        // _updateOnConfidentialConversion super: 1 entry (from=bob, to=bob, amount=30e18, context=bytes32(0))
        assertEq(entriesAfter, entriesBefore + 2, "Should create two wormhole entries: inner loop + _mintWithContext");

        ShieldedPool.TransferMetadata memory innerEntry = shieldedPool.wormholeEntry(entriesBefore);
        assertEq(innerEntry.from, bob, "Inner loop entry from should be alice");
        assertEq(innerEntry.to, bob, "Inner loop entry to should be bob");
        assertEq(innerEntry.amount, 0, "Inner loop entry amount should be zero");
        assertEq(innerEntry.confidentialContext, contexts[0], "Inner loop entry should carry the context");

        ShieldedPool.TransferMetadata memory superEntry = shieldedPool.wormholeEntry(entriesBefore + 1);
        assertEq(superEntry.from, bob, "Super entry from should be bob");
        assertEq(superEntry.to, bob, "Super entry to should be bob");
        assertEq(superEntry.amount, 30e18, "Super entry amount should be 30e18");
        assertEq(superEntry.confidentialContext, bytes32(0), "Super entry context should be zero");
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

    function test_unshield_withConfidentialContext() public {
        bytes32 confContext = bytes32(uint256(42));

        vm.prank(address(shieldedPool));
        wormhole.unshield(alice, 0, 50e18, confContext);

        // _mintWithContext with non-zero context calls _convertToConfidential(address(0), alice, ...) — no public mint
        assertEq(wormhole.balanceOf(alice), 0, "Unshield with context should result in zero public balance");

        uint256 lastEntryId = shieldedPool.totalWormholeEntries() - 1;
        ShieldedPool.TransferMetadata memory entry = shieldedPool.wormholeEntry(lastEntryId);
        assertEq(entry.from, address(0), "Unshield entry from should be address(0)");
        assertEq(entry.to, alice);
        assertEq(entry.amount, 50e18);
        assertEq(entry.confidentialContext, confContext, "Unshield entry should carry confidentialContext");

        // Confidential commitment uses from=address(0) since _mintWithContext calls _convertToConfidential(address(0), to, ...)
        uint256 expectedCommitment = _computeConfidentialCommitment(address(0), alice, 0, 0, 50e18, confContext);
        assertTrue(wormhole.isConfidentialRoot(bytes32(expectedCommitment)), "Confidential root should be set after unshield with context");
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
        // 1. Alice deposits underlying → gets wrapped tokens (creates wormhole entry 0)
        _dealTokens(alice, 1000e18);
        assertEq(wormhole.balanceOf(alice), 1000e18);

        // 2. Alice converts some to confidential (creates wormhole entry 1)
        bytes32 confContext = bytes32(uint256(42));
        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 400e18, confContext);
        assertEq(wormhole.balanceOf(alice), 600e18, "Alice should have 600 after converting 400 to confidential");

        // 3. Alice transfers public tokens to bob (creates wormhole entry 2)
        vm.prank(alice);
        wormhole.transfer(bob, 200e18);
        assertEq(wormhole.balanceOf(alice), 400e18);
        assertEq(wormhole.balanceOf(bob), 200e18);

        // 4. Verify wormhole entries: deposit + convertToConfidential + transfer
        assertEq(shieldedPool.totalWormholeEntries(), 3, "Should have 3 entries: deposit + convertToConfidential + transfer");

        ShieldedPool.TransferMetadata memory depositEntry = shieldedPool.wormholeEntry(0);
        assertEq(depositEntry.from, address(0), "Entry 0 should be from address(0) (deposit)");
        assertEq(depositEntry.to, alice);
        assertEq(depositEntry.amount, 1000e18);
        assertEq(depositEntry.confidentialContext, bytes32(0));

        ShieldedPool.TransferMetadata memory convertEntry = shieldedPool.wormholeEntry(1);
        assertEq(convertEntry.from, alice);
        assertEq(convertEntry.to, bob);
        assertEq(convertEntry.amount, 400e18);
        assertEq(convertEntry.confidentialContext, confContext, "Entry 1 should carry confidentialContext");

        ShieldedPool.TransferMetadata memory transferEntry = shieldedPool.wormholeEntry(2);
        assertEq(transferEntry.from, alice);
        assertEq(transferEntry.to, bob);
        assertEq(transferEntry.amount, 200e18);
        assertEq(transferEntry.confidentialContext, bytes32(0), "Entry 2 should have zero confidentialContext");

        // 5. Approve and commit the convertToConfidential and transfer entries
        vm.prank(screener);
        IShieldedPool.WormholePreCommitment[] memory nodes = new IShieldedPool.WormholePreCommitment[](2);
        nodes[0] = IShieldedPool.WormholePreCommitment({entryId: 1, approved: true});
        nodes[1] = IShieldedPool.WormholePreCommitment({entryId: 2, approved: true});
        shieldedPool.appendManyWormholeLeaves(nodes);

        assertEq(shieldedPool.totalWormholeCommitments(), 2, "Both entries should be committed");

        (bytes32 wormholeRoot, uint256 size,) = shieldedPool.branchWormholeTree(0);
        assertEq(size, 2, "Branch wormhole tree should have 2 leaves");
        assertTrue(wormholeRoot != bytes32(0), "Wormhole root should be non-zero");
    }

    function test_convertToConfidential_thenConfidentialTransfer_thenConvertBack() public {
        _dealTokens(alice, 100e18);
        bytes32 confContext1 = bytes32(uint256(111));

        // Convert to confidential: burns 60e18 from alice
        vm.prank(alice);
        wormhole.convertToConfidential(bob, 0, 60e18, confContext1);
        assertEq(wormhole.balanceOf(alice), 40e18);

        // Confidential transfer (no public token changes, creates wormhole entry)
        uint256 depositCommitment = _computeConfidentialCommitment(alice, bob, 0, 0, 60e18, confContext1);
        bytes32 confRoot = bytes32(depositCommitment);

        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = keccak256("ct-nullifier");
        bytes32[] memory contexts = new bytes32[](1);
        contexts[0] = bytes32(uint256(222));

        uint256 entriesBefore = shieldedPool.totalWormholeEntries();

        vm.prank(alice);
        wormhole.confidentialTransfer(bob, confRoot, nullifiers, contexts, "proof");

        assertEq(shieldedPool.totalWormholeEntries(), entriesBefore + 1, "confidentialTransfer should create one wormhole entry per context");
        assertEq(wormhole.balanceOf(alice), 40e18, "Public balance should not change during confidential transfer");

        // Convert from confidential: WITHDRAWAL mints 40e18 to bob
        uint256 transferCommitment = poseidon2.hash_4(uint256(uint160(alice)), uint256(uint160(bob)), 0, uint256(contexts[0]));
        bytes32 newRoot = bytes32(poseidon2.hash_2(depositCommitment, transferCommitment));

        bytes32[] memory nullifiers2 = new bytes32[](1);
        nullifiers2[0] = keccak256("cf-nullifier");
        bytes32[] memory contexts2 = new bytes32[](1);
        contexts2[0] = bytes32(uint256(333));

        vm.prank(alice);
        wormhole.convertFromConfidential(bob, 0, 40e18, bytes32(0), newRoot, nullifiers2, contexts2, "proof");

        assertEq(wormhole.balanceOf(alice), 40e18, "Alice's public balance should not change");
        assertEq(wormhole.balanceOf(bob), 40e18, "Bob should receive minted public tokens");
    }
}
