import type { Address } from "viem";

export enum TransferType {
  TRANSFER = 1,
  WITHDRAWAL = 2,
}

export interface NoteDBShieldedEntry {
  id: string;
  treeNumber: number;
  leafIndex: number;
  srcChainId: number;
  dstChainId: number;
  from?: Address;
  note: {
    account: Address;
    asset: Address;
    assetId?: string;
    blinding: string;
    amount: string;
    transferType: TransferType;
  };
  status?: "available" | "used";
  usedAt?: string;
  committedAt?: string;
  memo?: string;
  blockNumber?: number;
  blockTimestamp?: number;
  masterTreeStatus?: "pending" | "included";
}

export interface NoteDBWormholeEntry {
  id: string;
  entryId: string;
  treeNumber: number;
  leafIndex: number;
  srcChainId: number;
  dstChainId: number;
  entry: {
    to: Address;
    from: Address;
    wormhole_secret: string;
    token: Address;
    token_id: string;
    amount: string;
  };
  status?: "pending" | "approved" | "rejected" | "completed" | "ragequitted";
  usedAt?: string;
  memo?: string;
  blockNumber?: number;
  blockTimestamp?: number;
  masterTreeStatus?: "pending" | "included";
}

export interface ShieldedTransferRequestOutputNote {
  chain_id: number;
  recipient: Address;
  blinding: string;
  amount: string;
  transfer_type: TransferType;
}

export interface ShieldedTransferRequest {
  id: string;
  account: Address;
  receiver: Address;
  token: Address;
  tokenId?: string;
  amount: string;
  srcChainId: number;
  dstChainId: number;
  status: string;
  shieldedInputNotes: NoteDBShieldedEntry[];
  wormholeInputNote?: NoteDBWormholeEntry;
  outputNotes: ShieldedTransferRequestOutputNote[];
  usedAt?: string;
}

export const shieldedStatuses = ["available", "used"] as const;
export const wormholeStatuses = [
  "pending",
  "approved",
  "rejected",
  "completed",
  "ragequitted",
] as const;
export const masterTreeStatuses = ["pending", "included"] as const;

export type ShieldedStatus = (typeof shieldedStatuses)[number];
export type WormholeStatus = (typeof wormholeStatuses)[number];
export type MasterTreeStatus = (typeof masterTreeStatuses)[number];
