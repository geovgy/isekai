import { Address, isAddress } from "viem";
import { WormholeTokenType } from "./types";

export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

export const SHIELDED_POOL_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_SHIELDED_POOL!;

// Per-chain RPC URLs
export const RPC_URL_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_SEPOLIA! ?? process.env.RPC_URL_SEPOLIA!;
export const RPC_URL_ARB_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_ARB_SEPOLIA! ?? process.env.RPC_URL_ARB_SEPOLIA!;
export const RPC_URL_OP_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_OP_SEPOLIA! ?? process.env.RPC_URL_OP_SEPOLIA!;
export const RPC_URL_BASE_SEPOLIA = process.env.NEXT_PUBLIC_RPC_URL_BASE_SEPOLIA! ?? process.env.RPC_URL_BASE_SEPOLIA!;

// Per-chain Subgraph URLs
export const SUBGRAPH_URL_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_SEPOLIA! ?? process.env.SUBGRAPH_URL_SEPOLIA!;
export const SUBGRAPH_URL_ARB_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_ARB_SEPOLIA! ?? process.env.SUBGRAPH_URL_ARB_SEPOLIA!;
export const SUBGRAPH_URL_OP_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_OP_SEPOLIA! ?? process.env.SUBGRAPH_URL_OP_SEPOLIA!;
export const SUBGRAPH_URL_BASE_SEPOLIA = process.env.NEXT_PUBLIC_SUBGRAPH_URL_BASE_SEPOLIA! ?? process.env.SUBGRAPH_URL_BASE_SEPOLIA!;

export const WORMHOLE_TOKENS = (process.env.NEXT_PUBLIC_WORMHOLE_TOKENS?.split(",") || []).filter(v => isAddress(v)) as Address[];
export const WORMHOLE_TOKEN_TYPES = (process.env.NEXT_PUBLIC_WORMHOLE_TOKEN_TYPES?.split(",") || []).filter(v => v != "") as WormholeTokenType[];

export const POLYMER_PROVER_API_URL = process.env.NEXT_PUBLIC_POLYMER_PROVER_API_URL!;
export const POLYMER_API_KEY = process.env.NEXT_PUBLIC_POLYMER_API_KEY!;