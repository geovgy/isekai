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

export interface BranchShieldedTreeUpdateEvent {
  id: string
  treeId: string
  root: string
  blockNumber: string
  blockTimestamp: string
  transactionHash: string
  branch: {
    address: string
  }
}

export async function queryLatestBranchTreesUpdated(chainId: number): Promise<BranchShieldedTreeUpdateEvent | null> {
  const data = await subgraphQuery<{ branchShieldedTreeUpdates: BranchShieldedTreeUpdateEvent[] }>(`
    query {
      branchShieldedTreeUpdates(orderBy: blockTimestamp, orderDirection: desc, first: 1) {
        id
        treeId
        root
        blockNumber
        blockTimestamp
        transactionHash
        branch {
          address
        }
      }
    }
  `, {}, chainId)
  return data.branchShieldedTreeUpdates[0] ?? null
}
