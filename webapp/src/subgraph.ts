import { getChainConfig, MASTER_CHAIN_ID, SUPPORTED_CHAIN_IDS } from "./chains";

export async function subgraphQuery<T>(
  queryString: string,
  variables: Record<string, unknown>,
  chainId?: number,
): Promise<T> {
  const url = getChainConfig(chainId ?? MASTER_CHAIN_ID).subgraphUrl;
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
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors ?? "No data returned")}`);
  }
  return json.data;
}

export async function subgraphQueryAllChains<T>(
  queryString: string,
  variables: Record<string, unknown>,
): Promise<{ chainId: number; data: T }[]> {
  const results = await Promise.all(
    SUPPORTED_CHAIN_IDS.map(async (chainId) => {
      const data = await subgraphQuery<T>(queryString, variables, chainId);
      return { chainId, data };
    })
  );
  return results;
}

export async function subgraphQueryMasterChain<T>(
  queryString: string,
  variables: Record<string, unknown>,
): Promise<T> {
  return subgraphQuery<T>(queryString, variables, MASTER_CHAIN_ID);
}

export async function queryPendingWormholeEntries(chainId?: number) {
  const query = 
  `
    query WormholeEntriesPending($orderBy: String!, $orderDirection: String!, $first: Int!) {
      wormholeEntries(
        where: { submitted: false },
        orderBy: $orderBy,
        orderDirection: $orderDirection,
        first: $first,
      ) {
        id
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
      id: string;
      from: string;
      to: string;
      token: string;
      tokenId: string;
      amount: string;
      blockTimestamp: string;
    }[]
  }>(query, {
    orderBy: "blockTimestamp",
    orderDirection: "asc",
    first: 100,
  }, chainId);
}