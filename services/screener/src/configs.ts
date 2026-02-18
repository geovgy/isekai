import type { Chain } from "viem";
import { sepolia, arbitrumSepolia } from "viem/chains";
import {
  RPC_URL_SEPOLIA,
  RPC_URL_ARB_SEPOLIA,
  SUBGRAPH_URL_SEPOLIA,
  SUBGRAPH_URL_ARB_SEPOLIA,
} from "./env";

export interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  subgraphUrl: string;
  label: string;
}

export const CHAINS: Record<number, ChainConfig> = {
  [sepolia.id]: {
    chain: sepolia,
    rpcUrl: RPC_URL_SEPOLIA,
    subgraphUrl: SUBGRAPH_URL_SEPOLIA,
    label: "Sepolia",
  },
  [arbitrumSepolia.id]: {
    chain: arbitrumSepolia,
    rpcUrl: RPC_URL_ARB_SEPOLIA,
    subgraphUrl: SUBGRAPH_URL_ARB_SEPOLIA,
    label: "Arbitrum Sepolia",
  },
};

export const ALL_CHAIN_IDS = Object.keys(CHAINS).map(Number);

export function getChain(chainId: number): ChainConfig {
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error(`No config for chain ${chainId}`);
  return cfg;
}
