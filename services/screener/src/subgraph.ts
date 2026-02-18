import type { Address } from "viem";
import { getChain } from "./configs";

export async function subgraphQuery<T>(queryString: string, variables: Record<string, unknown>, chainId: number): Promise<T> {
  const url = getChain(chainId).subgraphUrl;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: queryString, variables }),
  });

  const json = (await response.json()) as { data?: T | null; errors?: unknown[] };
  if (!json.data || json.errors) {
    throw new Error(`Subgraph error (chain ${chainId}): ${JSON.stringify(json.errors ?? "No data returned")}`);
  }
  return json.data;
}

export async function queryPendingWormholeEntries(chainId: number) {
  const query = `
    query WormholeEntriesPending($orderBy: String!, $orderDirection: String!, $first: Int!) {
      wormholeEntries(
        where: { submitted: false },
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        first: $first,
      ) {
        entryId
        from
        to
        token
        tokenId
        amount
        blockTimestamp
      }
    }
  `;
  return subgraphQuery<{
    wormholeEntries: {
      entryId: bigint;
      from: Address;
      to: Address;
      token: Address;
      tokenId: bigint;
      amount: bigint;
      blockTimestamp: bigint;
    }[]
  }>(query, {
    orderBy: "blockTimestamp",
    orderDirection: "asc",
    first: 100,
  }, chainId);
}
