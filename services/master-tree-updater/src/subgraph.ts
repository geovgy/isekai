import { getChain } from "./config"

async function subgraphQuery<T>(query: string, variables: Record<string, unknown>, chainId: number): Promise<T> {
  const url = getChain(chainId).subgraphUrl
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as { data?: T | null; errors?: unknown[] }
  if (!json.data || json.errors) {
    throw new Error(`Subgraph error (chain ${chainId}): ${JSON.stringify(json.errors ?? "No data")}`)
  }
  return json.data
}

export interface BranchTreesUpdatedEvent {
  id: string
  logIndex: string
  branchShieldedRoot: string
  branchWormholeRoot: string
  branchBlockNumber: string
  branchBlockTimestamp: string
  blockNumber: string
  blockTimestamp: string
  transactionHash: string
}

export async function queryLatestBranchTreesUpdated(chainId: number): Promise<BranchTreesUpdatedEvent | null> {
  const data = await subgraphQuery<{ branchTreesUpdateds: BranchTreesUpdatedEvent[] }>(`
    query {
      branchTreesUpdateds(orderBy: blockTimestamp, orderDirection: desc, first: 1) {
        id
        logIndex
        branchShieldedRoot
        branchWormholeRoot
        branchBlockNumber
        branchBlockTimestamp
        blockNumber
        blockTimestamp
        transactionHash
      }
    }
  `, {}, chainId)
  return data.branchTreesUpdateds[0] ?? null
}
