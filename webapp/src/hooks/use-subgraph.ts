import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  queryWormholeEntriesByAddress,
  queryWormholeEntriesByEntryIds,
  queryWormholeEntriesAllChains,
  queryLatestMasterWormholeTreeLeaves,
  queryLatestMasterShieldedTreeLeaves,
  queryLatestMasterTreesUpdatedOnChain,
  type MasterTreeLeafResult,
} from "../subgraph-queries";
import { Address } from "viem";
import { NoteDBShieldedEntry, NoteDBWormholeEntry } from "../types";
import { MASTER_CHAIN_ID } from "../config";
import { useShieldedPool } from "./use-shieldedpool";

export function useWormholeEntries(args?: {
  from?: Address;
  to?: Address;
  orderDirection?: "asc" | "desc";
  chainId?: number;
}) {
  return useQuery({
    queryKey: ["wormholeEntries", args],
    queryFn: () => queryWormholeEntriesByAddress(args),
  });
}

export function useWormholeEntriesAllChains(args?: {
  from?: Address;
  to?: Address;
  orderDirection?: "asc" | "desc";
}) {
  return useQuery({
    queryKey: ["wormholeEntriesAllChains", args],
    queryFn: () => queryWormholeEntriesAllChains(args),
  });
}

export function useWormholeEntriesByEntryIds(args: {
  entryIds: bigint[];
  orderDirection?: "asc" | "desc";
  chainId?: number;
}) {
  return useQuery({
    queryKey: ["wormholeEntriesByEntryIds", { ...args, entryIds: args.entryIds.map(id => id.toString()) }],
    queryFn: () => queryWormholeEntriesByEntryIds(args),
    enabled: args.entryIds.length > 0,
  });
}

function groupBy<T>(items: T[], keyFn: (item: T) => number): Record<number, T[]> {
  const result: Record<number, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

function findCoveringLeaf(
  leaves: MasterTreeLeafResult[],
  srcChainId: number,
  blockNumber: number,
): MasterTreeLeafResult | undefined {
  const candidates = leaves.filter(
    l => Number(l.branchChainId) === srcChainId && Number(l.branchBlockNumber) >= blockNumber
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((oldest, l) =>
    Number(l.blockNumber) < Number(oldest.blockNumber) ? l : oldest
  );
}

/**
 * Periodically syncs wormhole entry approval statuses and master tree inclusion
 * for both wormhole entries and shielded notes.
 *
 * Flow:
 * 1. Check pending wormhole entries for approval/rejection on their source chains
 * 2. Query master chain for MasterWormholeTreeLeaf / MasterShieldedTreeLeaf events
 * 3. For entries destined to master chain: mark included if leaf covers the entry's block
 * 4. For entries destined to branch chains: also verify the branch received the master update
 */
export function useMasterTreeInclusionSync() {
  const { data: shieldedPool } = useShieldedPool();
  const queryClient = useQueryClient();

  const { data: allNotes } = useQuery({
    queryKey: ["syncNotes", shieldedPool?.account],
    queryFn: async () => {
      if (!shieldedPool) return { shielded: [] as NoteDBShieldedEntry[], wormhole: [] as NoteDBWormholeEntry[] };
      const [shielded, wormhole] = await Promise.all([
        shieldedPool.getShieldedNotes(),
        shieldedPool.getWormholeNotes(),
      ]);
      return { shielded, wormhole };
    },
    enabled: !!shieldedPool,
    refetchInterval: 15_000,
  });

  // --- Step 1: Wormhole approval status ---
  const pendingApproval = allNotes?.wormhole.filter(n => n.status === "pending") ?? [];
  const approvalByChain = groupBy(pendingApproval, n => n.srcChainId);
  const approvalChainIds = Object.keys(approvalByChain).map(Number);

  const { data: approvalData } = useQuery({
    queryKey: ["wormholeApproval", approvalChainIds, pendingApproval.map(n => n.entryId)],
    queryFn: async () => {
      const results: { chainId: number; entries: Awaited<ReturnType<typeof queryWormholeEntriesByEntryIds>>["wormholeEntries"] }[] = [];
      await Promise.all(
        Object.entries(approvalByChain).map(async ([chainIdStr, notes]) => {
          const chainId = Number(chainIdStr);
          const data = await queryWormholeEntriesByEntryIds({
            entryIds: notes.map(n => BigInt(n.entryId)),
            chainId,
          });
          results.push({ chainId, entries: data.wormholeEntries });
        })
      );
      return results;
    },
    enabled: pendingApproval.length > 0,
    refetchInterval: 15_000,
  });

  // --- Step 2: Master tree inclusion for wormhole entries ---
  const pendingMasterWormhole = allNotes?.wormhole.filter(
    n => n.masterTreeStatus === "pending" && n.blockNumber != null
  ) ?? [];
  const wormholeSrcChainIds = [...new Set(pendingMasterWormhole.map(n => n.srcChainId))];

  const { data: masterWormholeLeaves } = useQuery({
    queryKey: ["masterWormholeLeaves", wormholeSrcChainIds],
    queryFn: async () => {
      const data = await queryLatestMasterWormholeTreeLeaves(wormholeSrcChainIds);
      return data.masterWormholeTreeLeaves;
    },
    enabled: wormholeSrcChainIds.length > 0,
    refetchInterval: 15_000,
  });

  // --- Step 3: Master tree inclusion for shielded notes ---
  const pendingMasterShielded = allNotes?.shielded.filter(
    n => n.masterTreeStatus === "pending" && n.blockNumber != null
  ) ?? [];
  const shieldedSrcChainIds = [...new Set(pendingMasterShielded.map(n => n.srcChainId))];

  const { data: masterShieldedLeaves } = useQuery({
    queryKey: ["masterShieldedLeaves", shieldedSrcChainIds],
    queryFn: async () => {
      const data = await queryLatestMasterShieldedTreeLeaves(shieldedSrcChainIds);
      return data.masterShieldedTreeLeaves;
    },
    enabled: shieldedSrcChainIds.length > 0,
    refetchInterval: 15_000,
  });

  // --- Step 4: For non-master destinations, query branch MasterTreesUpdated ---
  const allBranchDstChainIds = [...new Set([
    ...pendingMasterWormhole.filter(n => n.dstChainId !== MASTER_CHAIN_ID).map(n => n.dstChainId),
    ...pendingMasterShielded.filter(n => n.dstChainId !== MASTER_CHAIN_ID).map(n => n.dstChainId),
  ])];

  const { data: branchMasterUpdates } = useQuery({
    queryKey: ["branchMasterUpdates", allBranchDstChainIds],
    queryFn: async () => {
      const results: Record<number, { masterBlockNumber: string; masterBlockTimestamp: string } | null> = {};
      await Promise.all(
        allBranchDstChainIds.map(async chainId => {
          results[chainId] = await queryLatestMasterTreesUpdatedOnChain(chainId);
        })
      );
      return results;
    },
    enabled: allBranchDstChainIds.length > 0,
    refetchInterval: 15_000,
  });

  // --- Process all sync ---
  useEffect(() => {
    if (!shieldedPool || !allNotes) return;

    async function sync() {
      // A: Update wormhole approval statuses (atomic patch to avoid clobbering masterTreeStatus)
      if (approvalData) {
        for (const { chainId, entries } of approvalData) {
          for (const entry of entries) {
            if (!entry.submitted || !entry.commitment) continue;
            const cachedNote = pendingApproval.find(
              n => n.entryId === entry.entryId.toString() && n.srcChainId === chainId
            );
            if (!cachedNote) continue;
            try {
              await shieldedPool!.patchNote<NoteDBWormholeEntry>("wormhole_note", cachedNote.id, (current) => {
                if (current.status !== "pending") return null;
                return {
                  treeNumber: Number(entry.commitment!.treeId),
                  leafIndex: Number(entry.commitment!.leafIndex),
                  status: entry.commitment!.approved ? "approved" as const : "rejected" as const,
                  blockNumber: Number(entry.commitment!.blockNumber),
                  blockTimestamp: Number(entry.commitment!.blockTimestamp),
                };
              });
            } catch (e) {
              console.error(`Failed to update approval status for ${cachedNote.id}:`, e);
            }
          }
        }
      }

      // B: Master tree inclusion for wormhole entries
      // Condition: note.blockNumber <= leaf.branchBlockNumber (same srcChainId)
      //   AND latestMasterTreesUpdated(dstChainId).masterBlockNumber >= leaf.blockNumber
      if (masterWormholeLeaves?.length) {
        for (const note of pendingMasterWormhole) {
          let shouldInclude = false;

          if (note.srcChainId === MASTER_CHAIN_ID) {
            shouldInclude = true;
          } else {
            const leaf = findCoveringLeaf(masterWormholeLeaves, note.srcChainId, note.blockNumber ?? 0);
            if (!leaf) continue;

            if (note.dstChainId === MASTER_CHAIN_ID) {
              shouldInclude = true;
            } else if (branchMasterUpdates) {
              const branchUpdate = branchMasterUpdates[note.dstChainId];
              if (branchUpdate && Number(branchUpdate.masterBlockNumber) >= Number(leaf.blockNumber)) {
                shouldInclude = true;
              }
            }
          }

          if (shouldInclude) {
            try {
              await shieldedPool!.patchNote<NoteDBWormholeEntry>("wormhole_note", note.id, (current) => {
                if (current.masterTreeStatus !== "pending") return null;
                return { masterTreeStatus: "included" as const };
              });
            } catch (e) {
              console.error(`Failed to update master tree status for ${note.id}:`, e);
            }
          }
        }
      }

      // C: Master tree inclusion for shielded notes
      if (masterShieldedLeaves?.length) {
        for (const note of pendingMasterShielded) {
          let shouldInclude = false;

          if (note.srcChainId === MASTER_CHAIN_ID) {
            shouldInclude = true;
          } else {
            const leaf = findCoveringLeaf(masterShieldedLeaves, note.srcChainId, note.blockNumber ?? 0);
            if (!leaf) continue;

            if (note.dstChainId === MASTER_CHAIN_ID) {
              shouldInclude = true;
            } else if (branchMasterUpdates) {
              const branchUpdate = branchMasterUpdates[note.dstChainId];
              if (branchUpdate && Number(branchUpdate.masterBlockNumber) >= Number(leaf.blockNumber)) {
                shouldInclude = true;
              }
            }
          }

          if (shouldInclude) {
            try {
              await shieldedPool!.patchNote<NoteDBShieldedEntry>("shielded_note", note.id, (current) => {
                if (current.masterTreeStatus !== "pending") return null;
                return { masterTreeStatus: "included" as const };
              });
            } catch (e) {
              console.error(`Failed to update master tree status for ${note.id}:`, e);
            }
          }
        }
      }
    }

    sync().then(() => {
      queryClient.invalidateQueries({ queryKey: ["syncNotes"] });
      queryClient.invalidateQueries({ queryKey: ["wormholeNotes"] });
      queryClient.invalidateQueries({ queryKey: ["shieldedBalance"] });
      queryClient.invalidateQueries({ queryKey: ["shieldedBalances"] });
    });
  }, [shieldedPool, allNotes, approvalData, masterWormholeLeaves, masterShieldedLeaves, branchMasterUpdates, queryClient]);
}
