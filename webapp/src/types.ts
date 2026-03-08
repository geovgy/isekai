import type { Address, Hex } from "viem";

export type WormholeTokenType = "WETH" | "ERC20" | "ERC721" | "ERC1155" | "ERC4626" | "wERC20" | "wERC721" | "wERC1155" | "wERC4626";

// IndexedDB types

export interface NoteDBShieldedEntry {
  id: string // srcChainId:treeNumber:leafIndex
  treeNumber: number
  leafIndex: number
  srcChainId: number
  dstChainId: number
  from?: Address
  note: {
    account: Address
    asset: Address
    assetId: string | undefined
    blinding: string
    amount: string
    transferType: TransferType
  }
  status?: "available" | "used"
  usedAt?: string
  committedAt?: string
  memo?: string
  blockNumber?: number
  blockTimestamp?: number
  masterTreeStatus?: "pending" | "included"
}

export interface NoteDBWormholeEntry {
  id: string // srcChainId:entryId
  entryId: string
  treeNumber: number
  leafIndex: number
  srcChainId: number
  dstChainId: number
  entry: {
    to: Address
    from: Address
    wormhole_secret: string
    token: Address
    token_id: string
    amount: string
  }
  status?: "pending" | "approved" | "rejected" | "completed" | "ragequitted"
  usedAt?: string
  memo?: string
  blockNumber?: number
  blockTimestamp?: number
  masterTreeStatus?: "pending" | "included"
}

// Component Params

export interface BalanceInfo {
  publicBalance: bigint;
  privateBalance: bigint;
}

export interface Asset {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  balance: bigint;
}

export interface WormholeAsset extends Asset {
  implementation: Address;
}

// Prover Types

export enum TransferType {
  TRANSFER = 1,
  WITHDRAWAL = 2,
}

export interface InputNote {
  chain_id: bigint;
  blinding: bigint;
  amount: bigint;
  branch_index: bigint;
  branch_siblings: bigint[];
  branch_root: bigint;
  master_index: bigint;
  master_siblings: bigint[];
}

export interface OutputNote {
  chain_id: bigint;
  recipient: Address | bigint;
  blinding: bigint;
  amount: bigint;
  transfer_type: TransferType;
}

export interface WormholeNote {
  dst_chain_id: bigint;
  src_chain_id: bigint;
  entry_id: bigint;
  recipient: Address;
  wormhole_secret: bigint;
  asset_id: bigint;
  sender: Address;
  amount: bigint;
}

export interface WormholeDeposit extends WormholeNote {
  master_root: bigint;
  branch_root: bigint;
  branch_index: bigint;
  branch_siblings: bigint[];
  master_index: bigint;
  master_siblings: bigint[];
  is_approved: boolean;
}

export interface MarketInputNotePayload {
  chain_id: string;
  blinding: string;
  amount: string;
  branch_index: string;
  branch_siblings: string[];
  branch_root: string;
  master_index: string;
  master_siblings: string[];
}

export interface MarketWormholeNotePayload {
  dst_chain_id: string;
  src_chain_id: string;
  entry_id: string;
  recipient: Address;
  wormhole_secret: string;
  asset_id: string;
  sender: Address;
  amount: string;
  master_root: string;
  branch_root: string;
  branch_index: string;
  branch_siblings: string[];
  master_index: string;
  master_siblings: string[];
  is_approved: boolean;
}

export interface MarketOutputNotePayload {
  chain_id: string;
  recipient: string;
  blinding: string;
  amount: string;
  transfer_type: TransferType;
}

// Contract Types
export interface Withdrawal {
  to: Address;
  asset: Address;
  id: bigint;
  amount: bigint;
}

export interface ShieldedTx {
  chainId: bigint;
  wormholeRoot: Hex;
  wormholeNullifier: Hex;
  shieldedRoot: Hex;
  nullifiers: Hex[];
  commitments: bigint[];
  withdrawals: Withdrawal[];
}

export interface ShieldedTxStringified {
  chainId: string;
  wormholeRoot: Hex;
  wormholeNullifier: Hex;
  shieldedRoot: Hex;
  nullifiers: Hex[];
  commitments: string[];
  withdrawals: {
    to: Address;
    asset: Address;
    id: string;
    amount: string;
  }[];
}

export interface RagequitTx {
  entryId: bigint;
  approved: boolean;
  wormholeRoot: Hex;
  wormholeNullifier: Hex;
}