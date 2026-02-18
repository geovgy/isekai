import type { Address, Hex } from "viem"

export const RPC_URL_SEPOLIA = process.env.RPC_URL_SEPOLIA!
export const SUBGRAPH_URL_SEPOLIA = process.env.SUBGRAPH_URL_SEPOLIA!
export const RPC_URL_ARB_SEPOLIA = process.env.RPC_URL_ARB_SEPOLIA!
export const SUBGRAPH_URL_ARB_SEPOLIA = process.env.SUBGRAPH_URL_ARB_SEPOLIA!

export const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex
export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS as Address
export const POLYMER_PROVER_API_URL = process.env.POLYMER_PROVER_API_URL!
export const POLYMER_API_KEY = process.env.POLYMER_API_KEY!

if (!RPC_URL_SEPOLIA) throw new Error("RPC_URL_SEPOLIA env var is required")
if (!SUBGRAPH_URL_SEPOLIA) throw new Error("SUBGRAPH_URL_SEPOLIA env var is required")
if (!RPC_URL_ARB_SEPOLIA) throw new Error("RPC_URL_ARB_SEPOLIA env var is required")
if (!SUBGRAPH_URL_ARB_SEPOLIA) throw new Error("SUBGRAPH_URL_ARB_SEPOLIA env var is required")

if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required")
if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS env var is required")
if (!POLYMER_PROVER_API_URL) throw new Error("POLYMER_PROVER_API_URL env var is required")
if (!POLYMER_API_KEY) throw new Error("POLYMER_API_KEY env var is required")
