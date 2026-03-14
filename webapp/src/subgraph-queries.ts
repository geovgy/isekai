import { Address, Hex, numberToHex } from "viem";
import { subgraphQuery, subgraphQueryAllChains, subgraphQueryMasterChain } from "./subgraph";
import { getMerkleTree } from "./merkle";
import { MASTER_CHAIN_ID, SUPPORTED_CHAIN_IDS } from "./chains";

export async function getMerkleTrees({
  wormholeTreeId,
  shieldedTreeId,
  chainId,
  branchAddress,
}: {
  wormholeTreeId: bigint;
  shieldedTreeId: bigint;
  chainId?: number;
  branchAddress?: Address;
}) {
  const commitments = await queryCommitments({ wormholeTreeId, shieldedTreeId, chainId, branchAddress });
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
  branchAddress?: Address;
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
    branch: {
      address: Address;
    };
  }[];
}> {
  const shieldedTransfersWhere = args.branchAddress
    ? "{ treeId: $shieldedTreeId, branch_: { address: $branchAddress } }"
    : "{ treeId: $shieldedTreeId }";
  const query = `
    query Commitments($wormholeTreeId: BigInt!, $shieldedTreeId: BigInt!, $branchAddress: Bytes) {
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
        where: ${shieldedTransfersWhere}
        orderBy: startIndex
        orderDirection: asc
        first: 1000
      ) {
        treeId
        startIndex
        commitments
        branch {
          address
        }
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
      branch: {
        address: Address;
      };
    }[];
  }>(query, {
    wormholeTreeId: args.wormholeTreeId.toString(),
    shieldedTreeId: args.shieldedTreeId.toString(),
    branchAddress: args.branchAddress,
  }, args.chainId);
}

export async function queryTrees(args: {
  wormholeTreeId: number;
  shieldedTreeId: number;
  chainId?: number;
  branchAddress?: Address;
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
    branchAddress: Address;
  } | null;
}> {
  const wormholeTreeId = numberToHex(args.wormholeTreeId, { size: 4 });
  const branchShieldedTreeWhere = args.branchAddress
    ? "{ treeId: $shieldedTreeId, branch_: { chainId: $branchChainId, address: $branchAddress } }"
    : "{ treeId: $shieldedTreeId, branch_: { chainId: $branchChainId } }";
  const query = `
    query Trees($wormholeTreeId: Bytes!, $shieldedTreeId: BigInt!, $branchChainId: BigInt, $branchAddress: Bytes) {
      wormholeTree(id: $wormholeTreeId) {
        id
        leaves
        size
        createdAt
        updatedAt
      }
      branchShieldedTrees(
        where: ${branchShieldedTreeWhere}
        first: 1
      ) {
        treeId
        roots
        size
        createdAt
        updatedAt
        branch {
          address
        }
      }
    }
  `;
  const data = await subgraphQuery<{
    wormholeTree: {
      id: number;
      leaves: bigint[];
      size: number;
      createdAt: number;
      updatedAt: number;
    } | null;
    branchShieldedTrees: {
      treeId: number;
      roots: bigint[];
      size: number;
      createdAt: number;
      updatedAt: number;
      branch: {
        address: Address;
      };
    }[];
  }>(query, {
    wormholeTreeId,
    shieldedTreeId: args.shieldedTreeId.toString(),
    branchChainId: args.chainId?.toString(),
    branchAddress: args.branchAddress,
  }, args.chainId);
  const shieldedTree = data.branchShieldedTrees[0]
    ? {
        id: data.branchShieldedTrees[0].treeId,
        leaves: data.branchShieldedTrees[0].roots,
        size: data.branchShieldedTrees[0].size,
        createdAt: data.branchShieldedTrees[0].createdAt,
        updatedAt: data.branchShieldedTrees[0].updatedAt,
        branchAddress: data.branchShieldedTrees[0].branch.address,
      }
    : null;
  return {
    wormholeTree: data.wormholeTree,
    shieldedTree,
  };
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
          token
          tokenId
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
        token: Address;
        tokenId: bigint;
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
    query BranchShieldedTreeUpdates($blockTimestamp_gte: BigInt, $branchChainId: BigInt!) {
      branchShieldedTreeUpdates(
        where: { blockTimestamp_gte: $blockTimestamp_gte, branch_: { chainId: $branchChainId } }
        orderBy: blockTimestamp
        orderDirection: asc
        first: 1000
      ) {
        id
        treeId
        root
        blockNumber
        blockTimestamp
        transactionHash
      }
    }
  `;
  return subgraphQuery<{
    branchShieldedTreeUpdates: {
      id: string;
      treeId: bigint;
      root: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
      transactionHash: Hex;
    }[];
  }>(query, {
    blockTimestamp_gte: args.blockTimestamp_gte,
    branchChainId: args.chainId.toString(),
  }, args.chainId);
}

export async function queryLatestBranchTreesUpdated(args: {
  chainId: number;
}) {
  const query = `
    query LatestBranchShieldedTreeUpdated($branchChainId: BigInt!) {
      branchShieldedTreeUpdates(
        where: { branch_: { chainId: $branchChainId } }
        orderBy: blockTimestamp
        orderDirection: desc
        first: 1
      ) {
        id
        treeId
        root
        blockNumber
        blockTimestamp
        transactionHash
      }
    }
  `;
  const data = await subgraphQuery<{
    branchShieldedTreeUpdates: {
      id: string;
      treeId: bigint;
      root: bigint;
      blockNumber: bigint;
      blockTimestamp: bigint;
      transactionHash: Hex;
    }[];
  }>(query, { branchChainId: args.chainId.toString() }, args.chainId);
  return data.branchShieldedTreeUpdates[0] ?? null;
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
  branchAddress: Address | null;
  branchBlockNumber: string;
  branchTimestamp: string;
  blockNumber: string;
  blockTimestamp: string;
}

async function queryBranchAddressesByChainIds(branchChainIds: number[]): Promise<Record<string, Address | null>> {
  if (branchChainIds.length === 0) {
    return {};
  }
  const query = `
    query BranchAddressesByChainIds($branchChainIds: [BigInt!]!) {
      branches(
        where: { chainId_in: $branchChainIds }
        first: 1000
      ) {
        chainId
        address
      }
    }
  `;
  const data = await subgraphQueryMasterChain<{
    branches: {
      chainId: string;
      address: Address;
    }[];
  }>(query, { branchChainIds: branchChainIds.map(String) });
  return data.branches.reduce<Record<string, Address | null>>((acc, branch) => {
    acc[branch.chainId] ??= branch.address;
    return acc;
  }, {});
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
  const [data, branchAddresses] = await Promise.all([
    subgraphQueryMasterChain<{
      masterWormholeTreeLeaves: Omit<MasterTreeLeafResult, "branchAddress">[];
    }>(query, { branchChainIds: branchChainIds.map(String) }),
    queryBranchAddressesByChainIds(branchChainIds),
  ]);
  return {
    masterWormholeTreeLeaves: data.masterWormholeTreeLeaves.map((leaf) => ({
      ...leaf,
      branchAddress: branchAddresses[leaf.branchChainId] ?? null,
    })),
  };
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
  const [data, branchAddresses] = await Promise.all([
    subgraphQueryMasterChain<{
      masterShieldedTreeLeaves: Omit<MasterTreeLeafResult, "branchAddress">[];
    }>(query, { branchChainIds: branchChainIds.map(String) }),
    queryBranchAddressesByChainIds(branchChainIds),
  ]);
  return {
    masterShieldedTreeLeaves: data.masterShieldedTreeLeaves.map((leaf) => ({
      ...leaf,
      branchAddress: branchAddresses[leaf.branchChainId] ?? null,
    })),
  };
}

export async function queryMasterTreeLeavesUpToBlock(args: {
  blockNumber: number;
}): Promise<{
  masterShieldedTreeLeaves: {
    branchRoot: string;
    branchChainId: string;
    branchAddress: Address | null;
    branchBlockNumber: string;
  }[];
  masterWormholeTreeLeaves: {
    branchRoot: string;
    branchChainId: string;
    branchAddress: Address | null;
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
  const data = await subgraphQueryMasterChain<{
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
  const branchChainIds = [...new Set([
    ...data.masterShieldedTreeLeaves.map((leaf) => Number(leaf.branchChainId)),
    ...data.masterWormholeTreeLeaves.map((leaf) => Number(leaf.branchChainId)),
  ])];
  const branchAddresses = await queryBranchAddressesByChainIds(branchChainIds);
  return {
    masterShieldedTreeLeaves: data.masterShieldedTreeLeaves.map((leaf) => ({
      ...leaf,
      branchAddress: branchAddresses[leaf.branchChainId] ?? null,
    })),
    masterWormholeTreeLeaves: data.masterWormholeTreeLeaves.map((leaf) => ({
      ...leaf,
      branchAddress: branchAddresses[leaf.branchChainId] ?? null,
    })),
  };
}

export async function queryBranchShieldedTreeSnapshot(args: {
  treeId: number;
  root: string;
  chainId: number;
  branchAddress?: Address;
}): Promise<{ leaves: string[]; size: string } | null> {
  const snapshotWhere = args.branchAddress
    ? `{ treeId: $treeId, root: $root, branch_: { chainId: $branchChainId, address: $branchAddress } }`
    : `{ treeId: $treeId, root: $root, branch_: { chainId: $branchChainId } }`;
  const snapshotQuery = `
    query BranchShieldedTreeSnapshot($treeId: BigInt!, $root: BigInt!, $branchChainId: BigInt!, $branchAddress: Bytes) {
      branchShieldedTreeSnapshots(
        where: ${snapshotWhere}
        first: 1
      ) {
        blockNumber
      }
    }
  `;
  const snapshotData = await subgraphQuery<{
    branchShieldedTreeSnapshots: { blockNumber: string }[];
  }>(snapshotQuery, {
    treeId: args.treeId.toString(),
    root: args.root,
    branchChainId: args.chainId.toString(),
    branchAddress: args.branchAddress,
  }, args.chainId);
  const snapshot = snapshotData.branchShieldedTreeSnapshots[0];
  if (!snapshot) {
    return null;
  }

  const transfersWhere = args.branchAddress
    ? `{ treeId: $treeId, blockNumber_lte: $blockNumber, branch_: { chainId: $branchChainId, address: $branchAddress } }`
    : `{ treeId: $treeId, blockNumber_lte: $blockNumber, branch_: { chainId: $branchChainId } }`;
  const transfersQuery = `
    query BranchShieldedTransfersUpToSnapshot($treeId: BigInt!, $branchChainId: BigInt!, $blockNumber: BigInt!, $branchAddress: Bytes) {
      shieldedTransfers(
        where: ${transfersWhere}
        orderBy: startIndex
        orderDirection: asc
        first: 1000
      ) {
        commitments
      }
    }
  `;
  const transfersData = await subgraphQuery<{
    shieldedTransfers: { commitments: string[] }[];
  }>(transfersQuery, {
    treeId: args.treeId.toString(),
    branchChainId: args.chainId.toString(),
    blockNumber: snapshot.blockNumber,
    branchAddress: args.branchAddress,
  }, args.chainId);
  const leaves = transfersData.shieldedTransfers.flatMap((transfer) => transfer.commitments);
  return {
    leaves,
    size: leaves.length.toString(),
  };
}

export async function queryBranchShieldedTransferSigners(args: {
  chainId: number;
  branchAddress?: Address;
  blockNumber_lte?: bigint;
  first?: number;
}): Promise<{
  signerCommitment: string;
  signerNullifier: string;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
  treeId: string;
  startIndex: string;
}[]> {
  const whereClause = args.branchAddress
    ? args.blockNumber_lte !== undefined
      ? `{ blockNumber_lte: $blockNumber_lte, branch_: { chainId: $branchChainId, address: $branchAddress } }`
      : `{ branch_: { chainId: $branchChainId, address: $branchAddress } }`
    : args.blockNumber_lte !== undefined
      ? `{ blockNumber_lte: $blockNumber_lte, branch_: { chainId: $branchChainId } }`
      : `{ branch_: { chainId: $branchChainId } }`;
  const query = `
    query BranchShieldedTransferSigners($branchChainId: BigInt!, $branchAddress: Bytes, $blockNumber_lte: BigInt, $first: Int!) {
      shieldedTransferSigners(
        where: ${whereClause}
        orderBy: blockNumber
        orderDirection: asc
        first: $first
      ) {
        signerCommitment
        signerNullifier
        blockNumber
        blockTimestamp
        transactionHash
        shieldedTransfer {
          treeId
          startIndex
        }
      }
    }
  `;
  const data = await subgraphQuery<{
    shieldedTransferSigners: {
      signerCommitment: string;
      signerNullifier: string;
      blockNumber: string;
      blockTimestamp: string;
      transactionHash: string;
      shieldedTransfer: {
        treeId: string;
        startIndex: string;
      };
    }[];
  }>(query, {
    branchChainId: args.chainId.toString(),
    branchAddress: args.branchAddress,
    blockNumber_lte: args.blockNumber_lte?.toString(),
    first: args.first ?? 1000,
  }, args.chainId);

  return data.shieldedTransferSigners.map((entry) => ({
    signerCommitment: entry.signerCommitment,
    signerNullifier: entry.signerNullifier,
    blockNumber: entry.blockNumber,
    blockTimestamp: entry.blockTimestamp,
    transactionHash: entry.transactionHash,
    treeId: entry.shieldedTransfer.treeId,
    startIndex: entry.shieldedTransfer.startIndex,
  }));
}

export async function queryBranchWormholeTreeSnapshot(args: {
  treeId: number;
  root: string;
  chainId: number;
  branchAddress?: Address;
}): Promise<{ leaves: string[]; size: string } | null> {
  const whereClause = args.branchAddress
    ? `{ treeId: $treeId, root: $root, branch_: { chainId: $branchChainId, address: $branchAddress } }`
    : `{ treeId: $treeId, root: $root }`;
  const query = `
    query BranchWormholeTreeSnapshot($treeId: BigInt!, $root: BigInt!, $branchChainId: BigInt!, $branchAddress: Bytes) {
      branchWormholeTreeSnapshots(
        where: ${whereClause}
        first: 1
      ) {
        leaves
        size
      }
    }
  `;
  const data = await subgraphQuery<{
    branchWormholeTreeSnapshots: { leaves: string[]; size: string }[];
  }>(query, {
    treeId: args.treeId.toString(),
    root: args.root,
    branchChainId: args.chainId.toString(),
    branchAddress: args.branchAddress,
  }, args.chainId);
  return data.branchWormholeTreeSnapshots[0] ?? null;
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
  branchAddress: Address | null;
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
  const branchAddresses = await queryBranchAddressesByChainIds([args.branchChainId]);
  return data.masterShieldedTreeLeaves.map((leaf) => ({
    ...leaf,
    branchAddress: branchAddresses[args.branchChainId.toString()] ?? null,
  }));
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
  branchAddress: Address | null;
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
  const branchAddresses = await queryBranchAddressesByChainIds([args.branchChainId]);
  return data.masterWormholeTreeLeaves.map((leaf) => ({
    ...leaf,
    branchAddress: branchAddresses[args.branchChainId.toString()] ?? null,
  }));
}

export async function queryMasterWormholeTreeLeavesForBranchChain(args: {
  branchChainId: number;
  branchTimestamp_gte?: number;
}): Promise<{
  branchRoot: string;
  branchAddress: Address | null;
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
  const branchAddresses = await queryBranchAddressesByChainIds([args.branchChainId]);
  return data.masterWormholeTreeLeaves.map((leaf) => ({
    ...leaf,
    branchAddress: branchAddresses[args.branchChainId.toString()] ?? null,
  }));
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
