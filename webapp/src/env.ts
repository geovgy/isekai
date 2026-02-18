import { Address } from "viem";
import { WormholeTokenType } from "./types";

export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

export const SHIELDED_POOL_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_SHIELDED_POOL!;

// Per-chain RPC URLs
export const RPC_URL_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_SEPOLIA!;
export const RPC_URL_ARB_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_ARB_SEPOLIA!;
export const RPC_URL_OP_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_OP_SEPOLIA!;
export const RPC_URL_BASE_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_BASE_SEPOLIA!;

// Per-chain Subgraph URLs
export const SUBGRAPH_URL_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA!;
export const SUBGRAPH_URL_ARB_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_ARB_SEPOLIA!;
export const SUBGRAPH_URL_OP_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_OP_SEPOLIA!;
export const SUBGRAPH_URL_BASE_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_BASE_SEPOLIA!;

export const WORMHOLE_TOKENS = process.env.NEXT_PUBLIC_WORMHOLE_TOKENS!.split(",") as Address[];
export const WORMHOLE_TOKEN_TYPES = process.env.NEXT_PUBLIC_WORMHOLE_TOKEN_TYPES!.split(",") as WormholeTokenType[];