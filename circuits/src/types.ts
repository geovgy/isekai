import type { Address } from "viem";

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