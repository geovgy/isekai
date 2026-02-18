import { createPublicClient, createWalletClient, http } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { PRIVATE_KEY } from "./env"
import { getChain } from "./config"

export const account = privateKeyToAccount(PRIVATE_KEY)

export function getPublicClient(chainId: number) {
  const cfg = getChain(chainId)
  return createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) })
}

export function getWalletClient(chainId: number) {
  const cfg = getChain(chainId)
  return createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpcUrl) })
}
