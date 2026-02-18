import type { Address, Hex } from "viem";

// IndexedDB types

export interface NoteDBShieldedEntry {
  id: string // chainId:treeNumber:leafIndex
  treeNumber: number
  leafIndex: number
  chainId: number
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
  id: string // same as entryId
  entryId: string
  treeNumber: number
  leafIndex: number
  chainId: number
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
  blinding: bigint;
  amount: bigint;
  leaf_index: bigint;
  leaf_siblings: bigint[];
}

export interface OutputNote {
  recipient: Address | bigint;
  blinding: bigint;
  amount: bigint;
  transfer_type: TransferType;
}

export interface WormholeNote {
  recipient: Address;
  wormhole_secret: bigint;
  asset_id: bigint;
  sender: Address;
  amount: bigint;
}

export interface WormholeDeposit extends WormholeNote {
  leaf_index: bigint;
  leaf_siblings: bigint[];
  is_approved: boolean;
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