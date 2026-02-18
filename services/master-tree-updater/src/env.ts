import type { Address, Hex } from "viem"

export const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex
export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS as Address
export const POLYMER_PROVER_API_URL = process.env.POLYMER_PROVER_API_URL!
export const POLYMER_API_KEY = process.env.POLYMER_API_KEY!

if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required")
if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS env var is required")
if (!POLYMER_PROVER_API_URL) throw new Error("POLYMER_PROVER_API_URL env var is required")
if (!POLYMER_API_KEY) throw new Error("POLYMER_API_KEY env var is required")
