import type { Address } from "viem";

export enum TransferType {
  TRANSFER = 1,
  WITHDRAWAL = 2,
}

export interface InputNote {
  chain_id: bigint;
  blinding: bigint;
  amount: bigint;
  leaf_index: bigint;
  leaf_siblings: bigint[];
  leaf_root: bigint;
  master_leaf_index: bigint;
  master_leaf_siblings: bigint[];
}

export interface OutputNote {
  chain_id: bigint;
  recipient: Address | bigint;
  blinding: bigint;
  amount: bigint;
  transfer_type: TransferType;
}

export interface WormholeNote {
  chain_id: bigint;
  recipient: Address;
  wormhole_secret: bigint;
  asset_id: bigint;
  sender: Address;
  amount: bigint;
}

export interface WormholeDeposit extends WormholeNote {
  tree_root: bigint;
  leaf_root: bigint;
  leaf_index: bigint;
  leaf_siblings: bigint[];
  master_leaf_index: bigint;
  master_leaf_siblings: bigint[];
  is_approved: boolean;
}