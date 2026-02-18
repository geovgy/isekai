import { createConfig, http } from 'wagmi'
import { getDefaultConfig } from 'connectkit'
import { sepolia, arbitrumSepolia, optimismSepolia, baseSepolia, type Chain } from 'wagmi/chains'
import {
  WALLETCONNECT_PROJECT_ID,
  SHIELDED_POOL_CONTRACT_ADDRESS,
  RPC_URL_SEPOLIA,
  RPC_URL_ARB_SEPOLIA,
  RPC_URL_OP_SEPOLIA,
  RPC_URL_BASE_SEPOLIA,
  SUBGRAPH_URL_SEPOLIA,
  SUBGRAPH_URL_ARB_SEPOLIA,
  SUBGRAPH_URL_OP_SEPOLIA,
  SUBGRAPH_URL_BASE_SEPOLIA,
} from './env'

export interface ChainConfig {
  chain: Chain
  rpcUrl: string
  subgraphUrl: string
  contractAddress: string
  isMaster: boolean
  label: string
}

export const MASTER_CHAIN_ID = sepolia.id

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  [sepolia.id]: {
    chain: sepolia,
    rpcUrl: RPC_URL_SEPOLIA,
    subgraphUrl: SUBGRAPH_URL_SEPOLIA,
    contractAddress: SHIELDED_POOL_CONTRACT_ADDRESS,
    isMaster: true,
    label: 'Sepolia',
  },
  [arbitrumSepolia.id]: {
    chain: arbitrumSepolia,
    rpcUrl: RPC_URL_ARB_SEPOLIA,
    subgraphUrl: SUBGRAPH_URL_ARB_SEPOLIA,
    contractAddress: SHIELDED_POOL_CONTRACT_ADDRESS,
    isMaster: false,
    label: 'Arbitrum Sepolia',
  },
  [optimismSepolia.id]: {
    chain: optimismSepolia,
    rpcUrl: RPC_URL_OP_SEPOLIA,
    subgraphUrl: SUBGRAPH_URL_OP_SEPOLIA,
    contractAddress: SHIELDED_POOL_CONTRACT_ADDRESS,
    isMaster: false,
    label: 'Optimism Sepolia',
  },
  [baseSepolia.id]: {
    chain: baseSepolia,
    rpcUrl: RPC_URL_BASE_SEPOLIA,
    subgraphUrl: SUBGRAPH_URL_BASE_SEPOLIA,
    contractAddress: SHIELDED_POOL_CONTRACT_ADDRESS,
    isMaster: false,
    label: 'Base Sepolia',
  },
}

export const SUPPORTED_CHAIN_IDS = Object.keys(SUPPORTED_CHAINS).map(Number)

export function getChainConfig(chainId: number): ChainConfig {
  const config = SUPPORTED_CHAINS[chainId]
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`)
  }
  return config
}

const chains = SUPPORTED_CHAIN_IDS.map(id => SUPPORTED_CHAINS[id].chain) as [Chain, ...Chain[]]

export const wagmiConfig = createConfig(
  getDefaultConfig({
    chains,
    transports: Object.fromEntries(
      SUPPORTED_CHAIN_IDS.map(id => [id, http(SUPPORTED_CHAINS[id].rpcUrl)])
    ),
    walletConnectProjectId: WALLETCONNECT_PROJECT_ID,
    appName: "Isekai",
    appDescription: "Cross-chain privacy via zkWormholes and shielded transfers",
  })
)
