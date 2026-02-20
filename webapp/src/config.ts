import { createConfig, http } from 'wagmi'
import { getDefaultConfig } from 'connectkit'
import { type Chain } from 'wagmi/chains'
import { WALLETCONNECT_PROJECT_ID } from './env'

export type { ChainConfig } from './chains'
export {
  MASTER_CHAIN_ID,
  SUPPORTED_CHAINS,
  SUPPORTED_CHAIN_IDS,
  getChainConfig,
} from './chains'

import { SUPPORTED_CHAINS, SUPPORTED_CHAIN_IDS } from './chains'

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
