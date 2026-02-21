import { Address, Hex, numberToHex } from "viem";
import { subgraphQuery, subgraphQueryAllChains, subgraphQueryMasterChain } from "./subgraph";
import { getMerkleTree } from "./merkle";
import { MASTER_CHAIN_ID, SUPPORTED_CHAIN_IDS } from "./config";

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

export async function queryMasterTrees(args: {
  wormholeTreeId: number;
  shieldedTreeId: number;
}): Promise<{
  masterWormholeTree: { leaves: string[]; size: string } | null;
  masterShieldedTree: { leaves: string[]; size: string } | null;
}> {
  const wormholeTreeId = numberToHex(args.wormholeTreeId, { size: 4 });
  const shieldedTreeId = numberToHex(args.shieldedTreeId, { size: 4 });
  const query = `
    query MasterTrees($wormholeTreeId: Bytes!, $shieldedTreeId: Bytes!) {
      masterWormholeTree(id: $wormholeTreeId) {
        leaves
        size
      }
      masterShieldedTree(id: $shieldedTreeId) {
        leaves
        size
      }
    }
  `;
  return subgraphQueryMasterChain<{
    masterWormholeTree: { leaves: string[]; size: string } | null;
    masterShieldedTree: { leaves: string[]; size: string } | null;
  }>(query, { wormholeTreeId, shieldedTreeId });
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
          blockNumber
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
        blockNumber: bigint;
        blockTimestamp: bigint;
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
        logIndex
        shieldedTreeId
        wormholeTreeId
        branchShieldedRoot
        branchWormholeRoot
        branchBlockNumber
        branchBlockTimestamp
        blockNumber
        blockTimestamp
        transactionHash
      }
    }
  `;
  return subgraphQuery<{
    branchTreesUpdateds: {
      id: string;
      logIndex: bigint;
      shieldedTreeId: bigint;
      wormholeTreeId: bigint;
      branchShieldedRoot: bigint;
      branchWormholeRoot: bigint;
      branchBlockNumber: bigint;
      branchBlockTimestamp: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
      transactionHash: Hex;
    }[];
  }>(query, { blockTimestamp_gte: args.blockTimestamp_gte }, args.chainId);
}

export async function queryLatestBranchTreesUpdated(args: {
  chainId: number;
}) {
  const query = `
    query LatestBranchTreesUpdated {
      branchTreesUpdateds(
        orderBy: blockTimestamp
        orderDirection: desc
        first: 1
      ) {
        id
        logIndex
        shieldedTreeId
        wormholeTreeId
        branchShieldedRoot
        branchWormholeRoot
        branchBlockNumber
        branchBlockTimestamp
        blockNumber
        blockTimestamp
        transactionHash
      }
    }
  `;
  const data = await subgraphQuery<{
    branchTreesUpdateds: {
      id: string;
      logIndex: bigint;
      shieldedTreeId: bigint;
      wormholeTreeId: bigint;
      branchShieldedRoot: bigint;
      branchWormholeRoot: bigint;
      branchBlockNumber: bigint;
      branchBlockTimestamp: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
      transactionHash: Hex;
    }[];
  }>(query, {}, args.chainId);
  return data.branchTreesUpdateds[0] ?? null;
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
        masterBlockNumber
        masterBlockTimestamp
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
      masterBlockNumber: bigint;
      masterBlockTimestamp: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
    }[];
  }>(query, { blockTimestamp_gte: args?.blockTimestamp_gte });
}

export interface MasterTreeLeafResult {
  branchChainId: string;
  branchBlockNumber: string;
  branchTimestamp: string;
  blockNumber: string;
  blockTimestamp: string;
}

export async function queryLatestMasterWormholeTreeLeaves(branchChainIds: number[]) {
  const query = `
    query LatestMasterWormholeTreeLeaves($branchChainIds: [BigInt!]!) {
      masterWormholeTreeLeaves(
        where: { branchChainId_in: $branchChainIds }
        orderBy: branchBlockNumber
        orderDirection: desc
        first: 1000
      ) {
        branchChainId
        branchBlockNumber
        branchTimestamp
        blockNumber
        blockTimestamp
      }
    }
  `;
  return subgraphQueryMasterChain<{
    masterWormholeTreeLeaves: MasterTreeLeafResult[];
  }>(query, { branchChainIds: branchChainIds.map(String) });
}

export async function queryLatestMasterShieldedTreeLeaves(branchChainIds: number[]) {
  const query = `
    query LatestMasterShieldedTreeLeaves($branchChainIds: [BigInt!]!) {
      masterShieldedTreeLeaves(
        where: { branchChainId_in: $branchChainIds }
        orderBy: branchBlockNumber
        orderDirection: desc
        first: 1000
      ) {
        branchChainId
        branchBlockNumber
        branchTimestamp
        blockNumber
        blockTimestamp
      }
    }
  `;
  return subgraphQueryMasterChain<{
    masterShieldedTreeLeaves: MasterTreeLeafResult[];
  }>(query, { branchChainIds: branchChainIds.map(String) });
}

export async function queryMasterTreeLeavesUpToBlock(args: {
  blockNumber: number;
}): Promise<{
  masterShieldedTreeLeaves: {
    branchRoot: string;
    branchChainId: string;
    branchBlockNumber: string;
  }[];
  masterWormholeTreeLeaves: {
    branchRoot: string;
    branchChainId: string;
    branchBlockNumber: string;
  }[];
}> {
  const query = `
    query MasterTreeLeavesUpToBlock($blockNumber: BigInt!) {
      masterShieldedTreeLeaves(
        where: { blockNumber_lte: $blockNumber }
        orderBy: blockNumber
        orderDirection: asc
        first: 1000
      ) {
        branchRoot
        branchChainId
        branchBlockNumber
      }
      masterWormholeTreeLeaves(
        where: { blockNumber_lte: $blockNumber }
        orderBy: blockNumber
        orderDirection: asc
        first: 1000
      ) {
        branchRoot
        branchChainId
        branchBlockNumber
      }
    }
  `;
  return subgraphQueryMasterChain<{
    masterShieldedTreeLeaves: {
      branchRoot: string;
      branchChainId: string;
      branchBlockNumber: string;
    }[];
    masterWormholeTreeLeaves: {
      branchRoot: string;
      branchChainId: string;
      branchBlockNumber: string;
    }[];
  }>(query, { blockNumber: args.blockNumber.toString() });
}

export async function queryBranchShieldedTreeSnapshot(args: {
  treeId: number;
  root: string;
  chainId: number;
}): Promise<{ leaves: string[]; size: string } | null> {
  const id = `${args.treeId}:${args.root}`;
  const query = `
    query BranchShieldedTreeSnapshot($id: ID!) {
      branchShieldedTreeSnapshot(id: $id) {
        leaves
        size
      }
    }
  `;
  const data = await subgraphQuery<{
    branchShieldedTreeSnapshot: { leaves: string[]; size: string } | null;
  }>(query, { id }, args.chainId);
  return data.branchShieldedTreeSnapshot;
}

export async function queryBranchWormholeTreeSnapshot(args: {
  treeId: number;
  root: string;
  chainId: number;
}): Promise<{ leaves: string[]; size: string } | null> {
  const id = `${args.treeId}:${args.root}`;
  const query = `
    query BranchWormholeTreeSnapshot($id: ID!) {
      branchWormholeTreeSnapshot(id: $id) {
        leaves
        size
      }
    }
  `;
  const data = await subgraphQuery<{
    branchWormholeTreeSnapshot: { leaves: string[]; size: string } | null;
  }>(query, { id }, args.chainId);
  return data.branchWormholeTreeSnapshot;
}

export async function queryLatestMasterTreesUpdatedOnChain(chainId: number) {
  const query = `
    query LatestMasterTreesUpdated {
      masterTreesUpdateds(
        orderBy: masterBlockTimestamp
        orderDirection: desc
        first: 1
      ) {
        masterBlockNumber
        masterBlockTimestamp
        masterShieldedTreeId
        masterWormholeTreeId
        masterShieldedRoot
        masterWormholeRoot
        blockNumber
        blockTimestamp
      }
    }
  `;
  const data = await subgraphQuery<{
    masterTreesUpdateds: {
      masterBlockNumber: string;
      masterBlockTimestamp: string;
      masterShieldedTreeId: string;
      masterWormholeTreeId: string;
      masterShieldedRoot: string;
      masterWormholeRoot: string;
      blockNumber: string;
      blockTimestamp: string;
    }[];
  }>(query, {}, chainId);
  return data.masterTreesUpdateds[0] ?? null;
}

export async function queryMasterShieldedTreeSnapshot(args: {
  treeId: number;
  root: string;
}): Promise<{ leaves: string[]; size: string } | null> {
  const id = `${args.treeId}:${args.root}`;
  const query = `
    query MasterShieldedTreeSnapshot($id: ID!) {
      masterShieldedTreeSnapshot(id: $id) {
        leaves
        size
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterShieldedTreeSnapshot: { leaves: string[]; size: string } | null;
  }>(query, { id });
  return data.masterShieldedTreeSnapshot;
}

export async function queryLatestMasterWormholeTreeSnapshot(chainId: number): Promise<{ treeId: string; root: string; leaves: string[]; size: string; createdAt: string } | null> {
  const query = `
    query LatestMasterWormholeTreeSnapshot {
      masterWormholeTreeSnapshots(
        orderBy: createdAt
        orderDirection: desc
        first: 1
      ) {
        treeId
        root
        leaves
        size
        createdAt
      }
    }
  `;
  const data = await subgraphQuery<{
    masterWormholeTreeSnapshots: { treeId: string; root: string; leaves: string[]; size: string; createdAt: string }[];
  }>(query, {}, chainId);
  return data.masterWormholeTreeSnapshots[0] ?? null;
}

export async function queryMasterWormholeTreeSnapshot(args: {
  treeId: number;
  root: string;
}): Promise<{ leaves: string[]; size: string } | null> {
  const id = `${args.treeId}:${args.root}`;
  const query = `
    query MasterWormholeTreeSnapshot($id: ID!) {
      masterWormholeTreeSnapshot(id: $id) {
        leaves
        size
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterWormholeTreeSnapshot: { leaves: string[]; size: string } | null;
  }>(query, { id });
  return data.masterWormholeTreeSnapshot;
}

export async function queryMasterShieldedTreeLeavesForBranchChain(args: {
  branchChainId: number;
  branchTimestamp_gte?: number;
}): Promise<{
  branchRoot: string;
  branchTimestamp: string;
  blockTimestamp: string;
  treeId: string;
}[]> {
  const whereClause = args.branchTimestamp_gte !== undefined
    ? `{ branchChainId: $branchChainId, branchTimestamp_gte: $branchTimestamp_gte }`
    : `{ branchChainId: $branchChainId }`;
  const query = `
    query MasterShieldedTreeLeavesForBranchChain($branchChainId: BigInt!, $branchTimestamp_gte: BigInt) {
      masterShieldedTreeLeaves(
        where: ${whereClause}
        orderBy: branchTimestamp
        orderDirection: desc
        first: 100
      ) {
        branchRoot
        branchTimestamp
        blockTimestamp
        treeId
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterShieldedTreeLeaves: {
      branchRoot: string;
      branchTimestamp: string;
      blockTimestamp: string;
      treeId: string;
    }[];
  }>(query, {
    branchChainId: args.branchChainId.toString(),
    branchTimestamp_gte: args.branchTimestamp_gte?.toString(),
  });
  return data.masterShieldedTreeLeaves;
}

export async function queryAllMasterWormholeTreeLeaves(args: {
  treeId: number;
}): Promise<{
  branchRoot: string;
  blockNumber: string;
  blockTimestamp: string;
}[]> {
  const query = `
    query AllMasterWormholeTreeLeaves($treeId: BigInt!) {
      masterWormholeTreeLeaves(
        where: { treeId: $treeId }
        orderBy: blockNumber
        orderDirection: asc
        first: 1000
      ) {
        branchRoot
        blockNumber
        blockTimestamp
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterWormholeTreeLeaves: {
      branchRoot: string;
      blockNumber: string;
      blockTimestamp: string;
    }[];
  }>(query, { treeId: args.treeId.toString() });
  return data.masterWormholeTreeLeaves;
}

export async function queryAllMasterShieldedTreeLeaves(args: {
  treeId: number;
}): Promise<{
  branchRoot: string;
  blockNumber: string;
  blockTimestamp: string;
}[]> {
  const query = `
    query AllMasterShieldedTreeLeaves($treeId: BigInt!) {
      masterShieldedTreeLeaves(
        where: { treeId: $treeId }
        orderBy: blockNumber
        orderDirection: asc
        first: 1000
      ) {
        branchRoot
        blockNumber
        blockTimestamp
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterShieldedTreeLeaves: {
      branchRoot: string;
      blockNumber: string;
      blockTimestamp: string;
    }[];
  }>(query, { treeId: args.treeId.toString() });
  return data.masterShieldedTreeLeaves;
}

export async function queryMasterWormholeTreeLeavesForBranchChainWithinTimestampRange(args: {
  branchChainId: number;
  blockTimestamp_gte: number;
  blockTimestamp_lte: number;
}): Promise<{
  branchRoot: string;
  blockTimestamp: string;
  treeId: string;
}[]> {
  const query = `
    query MasterWormholeTreeLeavesForBranchChainWithinTimestampRange($branchChainId: BigInt!, $blockTimestamp_gte: BigInt!, $blockTimestamp_lte: BigInt!) {
      masterWormholeTreeLeaves(
        where: { branchChainId: $branchChainId, blockTimestamp_gte: $blockTimestamp_gte, blockTimestamp_lte: $blockTimestamp_lte }
        orderBy: blockTimestamp
        orderDirection: asc
        first: 100
      ) {
        branchRoot
        blockTimestamp
        treeId
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterWormholeTreeLeaves: {
      branchRoot: string;
      blockTimestamp: string;
      treeId: string;
    }[];
  }>(query, {
    branchChainId: args.branchChainId.toString(),
    blockTimestamp_gte: args.blockTimestamp_gte.toString(),
    blockTimestamp_lte: args.blockTimestamp_lte.toString(),
  });
  return data.masterWormholeTreeLeaves;
}

export async function queryMasterWormholeTreeLeavesForBranchChain(args: {
  branchChainId: number;
  branchTimestamp_gte?: number;
}): Promise<{
  branchRoot: string;
  branchTimestamp: string;
  blockTimestamp: string;
  treeId: string;
}[]> {
  const whereClause = args.branchTimestamp_gte !== undefined
    ? `{ branchChainId: $branchChainId, branchTimestamp_gte: $branchTimestamp_gte }`
    : `{ branchChainId: $branchChainId }`;
  const query = `
    query MasterWormholeTreeLeavesForBranchChain($branchChainId: BigInt!, $branchTimestamp_gte: BigInt) {
      masterWormholeTreeLeaves(
        where: ${whereClause}
        orderBy: branchTimestamp
        orderDirection: desc
        first: 100
      ) {
        branchRoot
        branchTimestamp
        blockTimestamp
        treeId
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterWormholeTreeLeaves: {
      branchRoot: string;
      branchTimestamp: string;
      blockTimestamp: string;
      treeId: string;
    }[];
  }>(query, {
    branchChainId: args.branchChainId.toString(),
    branchTimestamp_gte: args.branchTimestamp_gte?.toString(),
  });
  return data.masterWormholeTreeLeaves;
}

export async function queryMasterTreesUpdatedOnChain(chainId: number, args?: { first?: number }): Promise<{
  masterShieldedTreeId: string;
  masterWormholeTreeId: string;
  masterShieldedRoot: string;
  masterWormholeRoot: string;
  masterBlockTimestamp: string;
  blockTimestamp: string;
}[]> {
  const first = args?.first ?? 50
  const query = `
    query MasterTreesUpdatedOnChain($first: Int!) {
      masterTreesUpdateds(
        orderBy: blockTimestamp
        orderDirection: desc
        first: $first
      ) {
        masterShieldedTreeId
        masterWormholeTreeId
        masterShieldedRoot
        masterWormholeRoot
        masterBlockTimestamp
        blockTimestamp
      }
    }
  `
  const data = await subgraphQuery<{
    masterTreesUpdateds: {
      masterShieldedTreeId: string;
      masterWormholeTreeId: string;
      masterShieldedRoot: string;
      masterWormholeRoot: string;
      masterBlockTimestamp: string;
      blockTimestamp: string;
    }[];
  }>(query, { first }, chainId)
  return data.masterTreesUpdateds
}

export async function queryMasterTreesUpdatedWithinTimestampRange(args: {
  blockTimestamp_gte: number;
  blockTimestamp_lte: number;
}): Promise<{
  masterShieldedTreeId: string;
  masterWormholeTreeId: string;
  masterShieldedRoot: string;
  masterWormholeRoot: string;
  masterBlockTimestamp: string;
  blockTimestamp: string;
}[]> {
  const query = `
    query MasterTreesUpdatedWithinTimestampRange($blockTimestamp_gte: BigInt!, $blockTimestamp_lte: BigInt!) {
      masterTreesUpdateds(
        where: { blockTimestamp_gte: $blockTimestamp_gte, blockTimestamp_lte: $blockTimestamp_lte }
        orderBy: blockTimestamp
        orderDirection: asc
        first: 10
      ) {
        masterShieldedTreeId
        masterWormholeTreeId
        masterShieldedRoot
        masterWormholeRoot
        masterBlockTimestamp
        blockTimestamp
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    masterTreesUpdateds: {
      masterShieldedTreeId: string;
      masterWormholeTreeId: string;
      masterShieldedRoot: string;
      masterWormholeRoot: string;
      masterBlockTimestamp: string;
      blockTimestamp: string;
    }[];
  }>(query, {
    blockTimestamp_gte: args.blockTimestamp_gte.toString(),
    blockTimestamp_lte: args.blockTimestamp_lte.toString(),
  });
  return data.masterTreesUpdateds;
}
