import { Address, Hex, numberToHex } from "viem";
import { subgraphQuery, subgraphQueryAllChains, subgraphQueryMasterChain } from "./subgraph";
import { getMerkleTree } from "./merkle";
import { MASTER_CHAIN_ID } from "./config";

export async function getMerkleTrees({
  wormholeTreeId,
  shieldedTreeId,
  chainId,
}: {
  wormholeTreeId: bigint;
  shieldedTreeId: bigint;
  chainId?: number;
}) {
  const commitments = await queryCommitments({ wormholeTreeId, shieldedTreeId, chainId });
  const wormholeLeaves = commitments.wormholeCommitments.map(commitment => BigInt(commitment.commitment));
  const shieldedLeaves = commitments.shieldedTransfers.map(transfer => transfer.commitments.map(commitment => BigInt(commitment))).flat();
  const wormholeTree = getMerkleTree(wormholeLeaves.map(leaf => BigInt(leaf)));
  const shieldedTree = getMerkleTree(shieldedLeaves.map(leaf => BigInt(leaf)));
  return { wormholeTree, shieldedTree };
}

export async function queryCommitments(args: {
  wormholeTreeId: bigint;
  shieldedTreeId: bigint;
  chainId?: number;
}): Promise<{
  wormholeCommitments: {
    treeId: bigint;
    commitment: bigint;
    leafIndex: bigint;
    approved: boolean;
    entry: {
      entryId: bigint;
    };
  }[];
  shieldedTransfers: {
    treeId: bigint;
    startIndex: bigint;
    commitments: bigint[];
  }[];
}> {
  const query = `
    query Commitments($wormholeTreeId: BigInt!, $shieldedTreeId: BigInt!) {
      wormholeCommitments(
        where: { treeId: $wormholeTreeId }
        orderBy: leafIndex
        orderDirection: asc
        first: 1000
      ) {
        treeId
        commitment
        leafIndex
        approved
        entry {
          entryId
        }
      }
      shieldedTransfers(
        where: { treeId: $shieldedTreeId }
        orderBy: startIndex
        orderDirection: asc
        first: 1000
      ) {
        treeId
        startIndex
        commitments
      }
    }
  `;
  return subgraphQuery<{
    wormholeCommitments: {
      treeId: bigint;
      commitment: bigint;
      leafIndex: bigint;
      approved: boolean;
      entry: {
        entryId: bigint;
      };
    }[];
    shieldedTransfers: {
      treeId: bigint;
      startIndex: bigint;
      commitments: bigint[];
    }[];
  }>(query, {
    wormholeTreeId: args.wormholeTreeId.toString(),
    shieldedTreeId: args.shieldedTreeId.toString(),
  }, args.chainId);
}

export async function queryTrees(args: {
  wormholeTreeId: number;
  shieldedTreeId: number;
  chainId?: number;
}): Promise<{
  wormholeTree: {
    id: number;
    leaves: bigint[];
    size: number;
    createdAt: number;
    updatedAt: number;
  } | null;
  shieldedTree: {
    id: number;
    leaves: bigint[];
    size: number;
    createdAt: number;
    updatedAt: number;
  } | null;
}> {
  const wormholeTreeId = numberToHex(args.wormholeTreeId, { size: 4 });
  const shieldedTreeId = numberToHex(args.shieldedTreeId, { size: 4 });
  const query = `
    query Trees($wormholeTreeId: Bytes!, $shieldedTreeId: Bytes!) {
      wormholeTree(id: $wormholeTreeId) {
        id
        leaves
        size
        createdAt
        updatedAt
      }
      shieldedTree(id: $shieldedTreeId) {
        id
        leaves
        size
        createdAt
        updatedAt
      }
    }
  `;
  return subgraphQuery<{
    wormholeTree: {
      id: number;
      leaves: bigint[];
      size: number;
      createdAt: number;
      updatedAt: number;
    } | null;
    shieldedTree: {
      id: number;
      leaves: bigint[];
      size: number;
      createdAt: number;
      updatedAt: number;
    } | null;
  }>(query, { wormholeTreeId, shieldedTreeId }, args.chainId);
}

export async function queryWormholeEntriesByAddress(args?: {
  from?: Address;
  to?: Address;
  orderDirection?: "asc" | "desc";
  chainId?: number;
}) {
  const { from, to, orderDirection, chainId } = args ?? {};
  const variables = {
    from,
    to,
    orderBy: "blockTimestamp",
    orderDirection,
  };
  const query = `
    query WormholeEntriesByAddress($orderBy: String!, $orderDirection: String!, $from: Bytes, $to: Bytes) {
      wormholeEntries(
        where: { from: $from, to: $to }
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
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
      id: string;
      entryId: bigint;
      from: Address;
      to: Address;
      token: Address;
      tokenId: bigint;
      amount: bigint;
      blockTimestamp: bigint;
    }[];
  }>(query, variables, chainId);
}

export async function queryWormholeEntriesAllChains(args?: {
  from?: Address;
  to?: Address;
  orderDirection?: "asc" | "desc";
}) {
  const { from, to, orderDirection } = args ?? {};
  const variables = {
    from,
    to,
    orderBy: "blockTimestamp",
    orderDirection,
  };
  const query = `
    query WormholeEntriesByAddress($orderBy: String!, $orderDirection: String!, $from: Bytes, $to: Bytes) {
      wormholeEntries(
        where: { from: $from, to: $to }
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        id
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
  const results = await subgraphQueryAllChains<{
    wormholeEntries: {
      id: string;
      entryId: bigint;
      from: Address;
      to: Address;
      token: Address;
      tokenId: bigint;
      amount: bigint;
      blockTimestamp: bigint;
    }[];
  }>(query, variables);

  return results.flatMap(({ chainId, data }) =>
    data.wormholeEntries.map(entry => ({ ...entry, chainId }))
  );
}

export async function queryWormholeEntriesByEntryIds(args: {
  entryIds: bigint[];
  orderDirection?: "asc" | "desc";
  chainId?: number;
}) {
  const { entryIds, orderDirection, chainId } = args;
  const variables = {
    entryIds: entryIds.map(id => id.toString()),
    orderBy: "blockTimestamp",
    orderDirection,
  };
  const query = `
    query WormholeEntriesByEntryIds($orderBy: String!, $orderDirection: String!, $entryIds: [BigInt!]) {
      wormholeEntries(
        where: { entryId_in: $entryIds }
        orderBy: $orderBy
        orderDirection: $orderDirection
      ) {
        entryId
        submitted
        commitment {
          commitment
          treeId
          leafIndex
          assetId
          from
          to
          amount
          approved
          submittedBy
          blockTimestamp
          transactionHash
        }
        blockTimestamp
        transactionHash
      }
    }
  `;
  return subgraphQuery<{
    wormholeEntries: {
      id: string;
      entryId: bigint;
      submitted: boolean;
      commitment: {
        commitment: bigint;
        treeId: bigint;
        leafIndex: bigint;
        assetId: Address;
        from: Address;
        to: Address;
        amount: bigint;
        approved: boolean;
        submittedBy: Address;
      } | null;
      blockTimestamp: bigint;
      transactionHash: Hex;
    }[];
  }>(query, variables, chainId);
}

export async function queryBranchTreesUpdated(args: {
  chainId: number;
  blockTimestamp_gte?: string;
}) {
  const query = `
    query BranchTreesUpdated($blockTimestamp_gte: BigInt) {
      branchTreesUpdateds(
        where: { blockTimestamp_gte: $blockTimestamp_gte }
        orderBy: blockTimestamp
        orderDirection: asc
        first: 1000
      ) {
        id
        shieldedTreeId
        wormholeTreeId
        branchShieldedRoot
        branchWormholeRoot
        blockNumber
        blockTimestamp
      }
    }
  `;
  return subgraphQuery<{
    branchTreesUpdateds: {
      id: string;
      shieldedTreeId: bigint;
      wormholeTreeId: bigint;
      branchShieldedRoot: bigint;
      branchWormholeRoot: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
    }[];
  }>(query, { blockTimestamp_gte: args.blockTimestamp_gte }, args.chainId);
}

export async function queryMasterTreesUpdated(args?: {
  blockTimestamp_gte?: string;
}) {
  const query = `
    query MasterTreesUpdated($blockTimestamp_gte: BigInt) {
      masterTreesUpdateds(
        where: { blockTimestamp_gte: $blockTimestamp_gte }
        orderBy: blockTimestamp
        orderDirection: asc
        first: 1000
      ) {
        id
        masterShieldedRoot
        masterWormholeRoot
        blockNumber
        blockTimestamp
      }
    }
  `;
  return subgraphQueryMasterChain<{
    masterTreesUpdateds: {
      id: string;
      masterShieldedRoot: bigint;
      masterWormholeRoot: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
    }[];
  }>(query, { blockTimestamp_gte: args?.blockTimestamp_gte });
}
