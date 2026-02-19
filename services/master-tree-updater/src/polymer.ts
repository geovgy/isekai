import { bytesToHex } from "viem"
import { base64ToBytes } from "./base64"
import { POLYMER_PROVER_API_URL, POLYMER_API_KEY } from "./env"
import { mainnet, sepolia } from "viem/chains"

export interface PolymerProverAPIRequestProofResult {
  jsonrpc: string
  id: number
  result: number | string
}

export interface PolymerProverAPIQueryProofResult {
  jsonrpc: string
  id: number
  result: {
    status: "complete" | "error" | "pending"
    proof: string // base64-encoded bytes proof
  }
}

export async function getPolymerProofHex(args: {
  sourceChainId: number
  blockNumber: number
  logIndex: number
  pollIntervalMs?: number
  timeoutMs?: number
}): Promise<`0x${string}`> {
  if (!POLYMER_PROVER_API_URL || !POLYMER_API_KEY) {
    throw new Error("Polymer env not configured")
  }
  const api = new PolymerProverAPI({ url: POLYMER_PROVER_API_URL, apiKey: POLYMER_API_KEY })
  const { jobId } = await api.requestProof({
    chainId: args.sourceChainId,
    blockNumber: args.blockNumber,
    logIndex: args.logIndex
  })

  const pollEvery = args.pollIntervalMs ?? 1000
  const timeoutMs = args.timeoutMs ?? (args.sourceChainId === mainnet.id || args.sourceChainId === sepolia.id) ? 240_000 : 120_000
  const start = Date.now()

  if (args.sourceChainId === mainnet.id || args.sourceChainId === sepolia.id) {
    await new Promise((r) => setTimeout(r, 120_000))
  }

  while (Date.now() - start < timeoutMs) {
    const res = await api.queryProof(jobId)
    const status = res.result.status
    if (status === "error") throw new Error("Polymer proof error")
    if (status === "complete") {
      const bytes = base64ToBytes(res.result.proof)
      return bytesToHex(bytes)
    }
    await new Promise((r) => setTimeout(r, pollEvery))
  }

  throw new Error("Polymer proof timeout")
}

export class PolymerProverAPI {
  constructor(
    private readonly args: {
      url: string
      apiKey: string
    }
  ) {}

  async requestProof(p: { chainId: number; blockNumber: number; logIndex: number }) {
    const res = await fetch(this.args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.args.apiKey}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "polymer_requestProof",
        params: [
          {
            srcChainId: p.chainId,
            srcBlockNumber: p.blockNumber,
            globalLogIndex: p.logIndex
          }
        ]
      })
    })
    const data = (await res.json()) as PolymerProverAPIRequestProofResult
    if (!data.result) throw new Error("Failed to request proof")
    return { jobId: data.result, ...data }
  }

  async queryProof(jobId: number | string) {
    const res = await fetch(this.args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.args.apiKey}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "polymer_queryProof",
        params: [jobId]
      })
    })
    return (await res.json()) as PolymerProverAPIQueryProofResult
  }
}

