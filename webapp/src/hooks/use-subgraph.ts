import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  queryWormholeEntriesByAddress,
  queryWormholeEntriesByEntryIds,
  queryWormholeEntriesAllChains,
  queryBranchTreesUpdated,
  queryMasterTreesUpdated,
} from "../subgraph-queries";
import { Address } from "viem";
import { NoteDBShieldedEntry, NoteDBWormholeEntry } from "../types";
import { MASTER_CHAIN_ID, SUPPORTED_CHAIN_IDS } from "../config";
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

/**
 * Periodically checks whether pending notes have been included in the master tree.
 * 
 * A note on a branch chain is "included" when:
 * 1. A BranchTreesUpdated event on that chain fires after the note's block
 * 2. A MasterTreesUpdated event on the master chain fires after the branch update
 */
export function useMasterTreeInclusionSync() {
  const { data: shieldedPool } = useShieldedPool();

  const { data: pendingNotes } = useQuery({
    queryKey: ["pendingMasterTreeNotes", shieldedPool?.account],
    queryFn: async () => {
      if (!shieldedPool) return { shielded: [], wormhole: [] };
      const [shielded, wormhole] = await Promise.all([
        shieldedPool.getShieldedNotes(),
        shieldedPool.getWormholeNotes(),
      ]);
      return {
        shielded: shielded.filter(n => n.masterTreeStatus === "pending" && n.blockTimestamp),
        wormhole: wormhole.filter(n => n.masterTreeStatus === "pending" && n.blockTimestamp),
      };
    },
    enabled: !!shieldedPool,
    refetchInterval: 30_000,
  });

  const hasPending = (pendingNotes?.shielded?.length ?? 0) + (pendingNotes?.wormhole?.length ?? 0) > 0;

  const { data: masterUpdates } = useQuery({
    queryKey: ["masterTreesUpdated"],
    queryFn: () => queryMasterTreesUpdated(),
    enabled: hasPending,
    refetchInterval: 30_000,
  });

  const branchChainIds = [...new Set([
    ...(pendingNotes?.shielded?.map(n => n.chainId) ?? []),
    ...(pendingNotes?.wormhole?.map(n => n.chainId) ?? []),
  ])].filter(id => id !== MASTER_CHAIN_ID);

  const { data: branchUpdates } = useQuery({
    queryKey: ["branchTreesUpdated", branchChainIds],
    queryFn: async () => {
      const results: Record<number, { blockTimestamp: bigint }[]> = {};
      await Promise.all(
        branchChainIds.map(async (chainId) => {
          const data = await queryBranchTreesUpdated({ chainId });
          results[chainId] = data.branchTreesUpdateds.map(u => ({
            blockTimestamp: BigInt(u.blockTimestamp),
          }));
        })
      );
      return results;
    },
    enabled: branchChainIds.length > 0 && hasPending,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!shieldedPool || !pendingNotes || !masterUpdates || !branchUpdates) return;

    const latestMasterTimestamp = masterUpdates.masterTreesUpdateds.reduce(
      (max, u) => {
        const ts = BigInt(u.blockTimestamp);
        return ts > max ? ts : max;
      },
      0n,
    );

    if (latestMasterTimestamp === 0n) return;

    async function syncInclusion() {
      let updated = false;

      const checkAndUpdate = async (
        notes: (NoteDBShieldedEntry | NoteDBWormholeEntry)[],
        store: "shielded_note" | "wormhole_note",
      ) => {
        for (const note of notes) {
          if (note.chainId === MASTER_CHAIN_ID) continue;
          const chainBranches = branchUpdates?.[note.chainId];
          if (!chainBranches?.length) continue;

          const noteTs = BigInt(note.blockTimestamp ?? 0);
          const branchAfterNote = chainBranches.find(b => b.blockTimestamp >= noteTs);
          if (!branchAfterNote) continue;

          if (latestMasterTimestamp >= branchAfterNote.blockTimestamp) {
            const updatedNote = { ...note, masterTreeStatus: "included" as const };
            try {
              await shieldedPool!.updateNote(store, updatedNote);
              updated = true;
            } catch (e) {
              console.error(`Failed to update master tree status for ${note.id}:`, e);
            }
          }
        }
      };

      await checkAndUpdate(pendingNotes!.shielded, "shielded_note");
      await checkAndUpdate(pendingNotes!.wormhole, "wormhole_note");
    }

    syncInclusion();
  }, [shieldedPool, pendingNotes, masterUpdates, branchUpdates]);
}
