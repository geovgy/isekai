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

export interface SignerDelegation {
  chainId: bigint;
  owner: Address;
  delegate: Address;
  recipient: Address;
  recipientLocked: boolean;
  startTime: bigint;
  endTime: bigint;
  token: Address;
  tokenId: bigint;
  amount: bigint;
  amountType: number;
  maxCumulativeAmount: bigint;
  maxNonce: bigint;
  timeInterval: bigint;
  transferType: number;
}

export interface SignerNote {
  index: bigint;
  siblings: bigint[];
  total_amount: bigint;
  nonce: bigint;
  timestamp: bigint;
  blinding: bigint;
}

export enum ConfidentialType {
  NONE = 0,
  PARTIAL = 1,
  FULL = 2,
}

export interface WormholeNote {
  dst_chain_id: bigint;
  src_chain_id: bigint;
  entry_id: bigint;
  recipient: Address;
  wormhole_secret: bigint;
  token: bigint;
  token_id: bigint;
  to: Address;
  from: Address;
  amount: bigint;
  confidential_type: ConfidentialType;
}

export interface ConfidentialInputNote {
  tree_id: bigint;
  secret: bigint;
  amount: bigint;
  leaf_index: bigint;
  leaf_path: bigint[];
}

export interface ConfidentialOutputNote {
  wormhole_recipient: bigint | null;
  amount: bigint;
  secret: bigint;
  transfer_type: TransferType;
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