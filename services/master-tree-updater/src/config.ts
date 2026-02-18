import type { Chain } from "viem"
import { sepolia, arbitrumSepolia } from "viem/chains"
import { RPC_URL_SEPOLIA, RPC_URL_ARB_SEPOLIA, SUBGRAPH_URL_SEPOLIA, SUBGRAPH_URL_ARB_SEPOLIA } from "./env"
// import { optimismSepolia, baseSepolia } from "viem/chains"

export interface ChainConfig {
  chain: Chain
  rpcUrl: string
  subgraphUrl: string
  label: string
}

export const MASTER_CHAIN_ID = sepolia.id

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
  // Uncomment as needed:
  // [optimismSepolia.id]: {
  //   chain: optimismSepolia,
  //   rpcUrl: process.env.RPC_URL_OP_SEPOLIA!,
  //   subgraphUrl: process.env.SUBGRAPH_URL_OP_SEPOLIA!,
  //   label: "Optimism Sepolia",
  // },
  // [baseSepolia.id]: {
  //   chain: baseSepolia,
  //   rpcUrl: process.env.RPC_URL_BASE_SEPOLIA!,
  //   subgraphUrl: process.env.SUBGRAPH_URL_BASE_SEPOLIA!,
  //   label: "Base Sepolia",
  // },
}

export const BRANCH_CHAIN_IDS = Object.keys(CHAINS).map(Number).filter(id => id !== MASTER_CHAIN_ID)

export function getChain(chainId: number): ChainConfig {
  const cfg = CHAINS[chainId]
  if (!cfg) throw new Error(`No config for chain ${chainId}`)
  return cfg
}
