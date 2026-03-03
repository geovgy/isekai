// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import {IShieldedPool} from "../interfaces/IShieldedPool.sol";
import {Wormhole} from "../Wormhole.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract ERC4626Wormhole is IERC4626, ERC20, Wormhole, Ownable {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC4626;

    bool public initialized;

    IERC20 internal _asset;
    IERC4626 public vault;

    uint256 public poolId;

    uint256 private _totalShares; // also used as actual supply
    uint256 private _totalAssets;
    
    constructor(IShieldedPool shieldedPool_) ERC20("", "") Wormhole(shieldedPool_) Ownable(msg.sender) {}

    function initialize(bytes calldata data_) external onlyOwner {
        require(!initialized, "ERC4626Wormhole: already initialized");
        // extract asset and vault address from data_
        address vaultAddress = address(bytes20(data_[:20]));
        require(vaultAddress != address(0), "ERC4626Wormhole: vault address is zero address");
        IERC4626 _vault = IERC4626(vaultAddress);
        address assetAddress = _vault.asset();
        require(assetAddress != address(0), "ERC4626Wormhole: asset address is zero address");
        vault = _vault;
        _asset = IERC20(assetAddress);
        initialized = true;
        renounceOwnership();
    }

    function _unshield(address to, uint256 /* id */, uint256 amount, bytes32 /* confidentialContext */) internal override {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal virtual override {
        super._update(from, to, value);
        _requestWormholeEntry(from, to, 0, value, bytes32(0)); // id is always 0 for ERC20 tokens
    }

    function asset() external view returns (address) {
        return address(_asset);
    }

    function totalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    function actualSupply() public view override returns (uint256) {
        return _totalShares;
    }

    function convertToShares(uint256 assets) external view returns (uint256) {
        return vault.convertToShares(assets);
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        return vault.convertToAssets(shares);
    }

    function maxDeposit(address receiver) external view returns (uint256) {
        return vault.maxDeposit(receiver);
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return vault.previewDeposit(assets);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _asset.approve(address(vault), assets);
        shares = vault.deposit(assets, address(this));
        _totalShares += shares;
        _totalAssets += assets;
        // Mint equivalent of shares to the receiver
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function maxMint(address receiver) external view returns (uint256) {
        return vault.maxMint(receiver);
    }

    function previewMint(uint256 shares) external view returns (uint256) {
        return vault.previewMint(shares);
    }

    function mint(uint256 shares, address receiver) external returns (uint256 assets) {
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        uint256 preview = vault.previewMint(shares);
        _asset.approve(address(vault), preview);
        assets = vault.mint(shares, address(this));
        _totalShares += shares;
        _totalAssets += assets;
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        return vault.maxWithdraw(owner);
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return vault.previewWithdraw(assets);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = vault.withdraw(assets, address(this), address(this));
        _totalShares -= shares;
        _totalAssets -= assets;
        _burn(owner, shares);
        _asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return vault.maxRedeem(owner);
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return vault.previewRedeem(shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        assets = vault.redeem(shares, address(this), address(this));
        _totalShares -= shares;
        _totalAssets -= assets;
        _burn(owner, shares);
        _asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }
}