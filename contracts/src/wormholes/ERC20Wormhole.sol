// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IERC20, IERC20Metadata, ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import {IShieldedPool} from "../interfaces/IShieldedPool.sol";
import {Wormhole} from "../Wormhole.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

// A modified version of OpenZeppelin's ERC20Wrapper that supports wormhole
contract ERC20Wormhole is ERC20, Wormhole, Ownable {
    using SafeERC20 for IERC20;

    bool public initialized;

    IERC20 internal _underlying;

    uint256 private _supply;

    string private _namePrefix;
    string private _symbolPrefix;

    /**
     * @dev The underlying token couldn't be wrapped.
     */
    error ERC20InvalidUnderlying(address token);

    error ERC20InvalidOwner(address owner);

    constructor(
        IShieldedPool shieldedPool_,
        string memory namePrefix_,
        string memory symbolPrefix_
    ) ERC20("", "") Wormhole(shieldedPool_) Ownable(msg.sender) {
        _namePrefix = namePrefix_;
        _symbolPrefix = symbolPrefix_;
    }

    function initialize(bytes calldata data_) external onlyOwner {
        require(!initialized, "ERC20Wormhole: already initialized");
        // extract asset and vault address from data_
        address assetAddress = address(bytes20(data_[:20]));
        if (assetAddress == address(this) || assetAddress == address(0)) {
            revert ERC20InvalidUnderlying(assetAddress);
        }
        _underlying = IERC20(assetAddress);
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

    function actualSupply() public view override returns (uint256) {
        return _supply;
    }

    /// @inheritdoc IERC20Metadata
    function decimals() public view virtual override returns (uint8) {
        try IERC20Metadata(address(_underlying)).decimals() returns (uint8 value) {
            return value;
        } catch {
            return super.decimals();
        }
    }

    function name() public view virtual override returns (string memory) {
        try IERC20Metadata(address(_underlying)).name() returns (string memory value) {
            return string(bytes.concat(bytes(_namePrefix), bytes(value)));
        } catch {
            return super.name();
        }
    }

    function symbol() public view virtual override returns (string memory) {
        try IERC20Metadata(address(_underlying)).symbol() returns (string memory value) {
            return string(bytes.concat(bytes(_symbolPrefix), bytes(value)));
        } catch {
            return super.symbol();
        }
    }

    /**
     * @dev Returns the address of the underlying ERC-20 token that is being wrapped.
     */
    function underlying() public view returns (IERC20) {
        return _underlying;
    }

    /**
     * @dev Allow a user to deposit underlying tokens and mint the corresponding number of wrapped tokens.
     */
    function deposit(uint256 value, address receiver) public virtual returns (bool) {
        address sender = _msgSender();
        if (sender == address(this)) {
            revert ERC20InvalidSender(address(this));
        }
        if (receiver == address(this)) {
            revert ERC20InvalidReceiver(receiver);
        }
        SafeERC20.safeTransferFrom(_underlying, sender, address(this), value);
        unchecked {
            _supply += value;
        }
        _mint(receiver, value);
        return true;
    }

    /**
     * @dev Allow a user to burn a number of wrapped tokens and withdraw the corresponding number of underlying tokens.
     */
    function withdraw(uint256 value, address receiver, address owner) public virtual returns (bool) {
        if (owner == address(this)) {
            revert ERC20InvalidOwner(owner);
        }
        if (receiver == address(this)) {
            revert ERC20InvalidReceiver(receiver);
        }
        if (_msgSender() != owner) {
            _spendAllowance(owner, _msgSender(), value);
        }
        _burn(owner, value);
        unchecked {
            _supply -= value;
        }
        SafeERC20.safeTransfer(_underlying, receiver, value);
        return true;
    }

    /**
     * @dev Mint wrapped token to cover any underlyingTokens that would have been transferred by mistake or acquired from
     * rebasing mechanisms. Internal function that can be exposed with access control if desired.
     */
    function _recover(address account) internal virtual returns (uint256) {
        uint256 value = _underlying.balanceOf(address(this)) - actualSupply();
        _mint(account, value);
        return value;
    }
}