"use client";

import { useEffect, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { useConnection, useReadContracts } from "wagmi";
import { erc20Abi } from "viem";
import { NoteDBWormholeEntry } from "@/src/types";
import { Loader2, Clock, CheckCircle, XCircle, CircleDot, AlertTriangle, Wallet, ArrowRight } from "lucide-react";
import { useShieldedPool, useWormholeNotes } from "@/src/hooks/use-shieldedpool";
import { EthAddress } from "@/src/components/address";
import { formatBalance } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";
import { getWormholeBurnAddress } from "../joinsplits";
import { SUPPORTED_CHAINS } from "@/src/config";
import { queryWormholeEntriesByEntryIds } from "@/src/subgraph-queries";
import { useQuery } from "@tanstack/react-query";

const statusConfig: Record<string, { 
  style: string; 
  icon: React.ReactNode;
  label: string;
  description: string;
}> = {
  pending: {
    style: "bg-[#f97316]/10 text-[#f97316] border-[#f97316]/30",
    icon: <Clock className="size-4" />,
    label: "Pending",
    description: "Waiting for confirmation",
  },
  approved: {
    style: "bg-[#dc2626]/10 text-[#dc2626] border-[#dc2626]/30",
    icon: <CheckCircle className="size-4" />,
    label: "Approved",
    description: "Transfer approved",
  },
  rejected: {
    style: "bg-[#1a1a1a]/10 text-[#1a1a1a] border-[#1a1a1a]/30",
    icon: <XCircle className="size-4" />,
    label: "Rejected",
    description: "Transfer rejected",
  },
  completed: {
    style: "bg-[#b91c1c]/10 text-[#b91c1c] border-[#b91c1c]/30",
    icon: <CircleDot className="size-4" />,
    label: "Completed",
    description: "Transfer completed",
  },
  ragequitted: {
    style: "bg-[#ea580c]/10 text-[#ea580c] border-[#ea580c]/30",
    icon: <AlertTriangle className="size-4" />,
    label: "Ragequit",
    description: "Emergency exit",
  },
};

function StatusBadge({ status }: { status: NoteDBWormholeEntry["status"] }) {
  const config = statusConfig[status ?? "pending"];
  return (
    <div className={`inline-flex flex-col items-center gap-1 px-3 py-2 rounded-xl border ${config.style}`}>
      <div className="flex items-center gap-1.5">
        {config.icon}
        <span className="text-xs font-semibold">{config.label}</span>
      </div>
    </div>
  );
}

function MasterTreeBadge({ masterTreeStatus }: { masterTreeStatus?: "pending" | "included" }) {
  if (!masterTreeStatus || masterTreeStatus === "included") {
    return <span className="text-xs text-green-600 font-medium">Synced</span>;
  }
  return <span className="text-xs text-amber-500 font-medium">Pending</span>;
}

function ChainBadge({ chainId }: { chainId: number }) {
  const label = SUPPORTED_CHAINS[chainId]?.label ?? `Chain ${chainId}`;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground border border-border/50">
      {label}
    </span>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
        <div className="relative w-16 h-16 rounded-2xl bg-muted flex items-center justify-center border border-border/50">
          <Icon className="w-8 h-8 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
    </div>
  );
}

export function WormholesTable() {
  const { address } = useConnection();

  const { data: shieldedPool, isLoading: isShieldedPoolLoading } = useShieldedPool();
  const { data: entries, refetch: refetchEntries, isLoading: isEntriesLoading } = useWormholeNotes();

  const { data } = useReadContracts({
    allowFailure: false,
    contracts: entries?.map((e) => ([
      {
        address: e.entry.token,
        abi: erc20Abi, // TODO: use dynamic abi by token standard
        functionName: "name",
      },
      {
        address: e.entry.token,
        abi: erc20Abi, // TODO: use dynamic abi by token standard
        functionName: "symbol",
      },
      {
        address: e.entry.token,
        abi: erc20Abi, // TODO: use dynamic abi by token standard
        functionName: "decimals",
      },
    ])).flat(),
    query: {
      enabled: !!entries?.length,
      select: (data) => {
        return entries?.map((e, i) => ({
          ...e,
          tokenMetadata: {
            name: data[i * 3] as string,
            symbol: data[i * 3 + 1] as string,
            decimals: data[i * 3 + 2] as number,
          }
        })) ?? [];
      },
    },
  })

  const pendingEntriesByChain = useMemo(() => {
    const grouped: Record<number, bigint[]> = {};
    for (const e of entries?.filter((e) => e.status === "pending" || !e.status) ?? []) {
      const chainId = e.chainId;
      if (!grouped[chainId]) grouped[chainId] = [];
      grouped[chainId].push(BigInt(e.entryId));
    }
    return grouped;
  }, [entries]);

  const hasPending = Object.values(pendingEntriesByChain).some(ids => ids.length > 0);

  const { data: subgraphData, isLoading: isSubgraphLoading } = useQuery({
    queryKey: ["wormholeEntriesByEntryIdsMultiChain", JSON.stringify(pendingEntriesByChain, (_, v) => typeof v === "bigint" ? v.toString() : v)],
    queryFn: async () => {
      const results = await Promise.all(
        Object.entries(pendingEntriesByChain).map(async ([chainIdStr, entryIds]) => {
          const chainId = Number(chainIdStr);
          const data = await queryWormholeEntriesByEntryIds({
            entryIds,
            orderDirection: "desc",
            chainId,
          });
          return data.wormholeEntries;
        })
      );
      return { wormholeEntries: results.flat() };
    },
    enabled: hasPending,
  });

  useEffect(() => {
    if (!subgraphData?.wormholeEntries?.length || !shieldedPool) return;

    async function syncFromSubgraph() {
      let updated = false;
      for (const sgEntry of subgraphData!.wormholeEntries) {
        if (sgEntry.submitted && sgEntry.commitment) {
          try {
            await shieldedPool!.updateWormholeEntryCommitment(sgEntry.entryId.toString(), {
              treeNumber: Number(sgEntry.commitment.treeId),
              leafIndex: Number(sgEntry.commitment.leafIndex),
              status: sgEntry.commitment.approved ? "approved" : "rejected",
            });
            updated = true;
          } catch (error) {
            console.error(`Failed to update entry ${sgEntry.entryId}:`, error);
          }
        }
      }
      if (updated) {
        refetchEntries();
      }
    }

    syncFromSubgraph();
  }, [subgraphData, shieldedPool, entries, refetchEntries]);

  if (!address) {
    return (
      <EmptyState 
        icon={Wallet}
        title="Connect your wallet"
        description="Connect your wallet to view your wormhole transfer history and track their status."
      />
    );
  }

  if (isShieldedPoolLoading || isEntriesLoading) {
    return (
      <EmptyState 
        icon={Loader2}
        title="Loading transfers..."
        description="Fetching your wormhole transfer history from the blockchain."
      />
    );
  }

  if (!entries?.length) {
    return (
      <EmptyState 
        icon={CircleDot}
        title="No wormhole transfers yet"
        description="Your wormhole transfers will appear here once you initiate them."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead className="w-[80px] pl-6">ID</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Dest</TableHead>
            <TableHead>Asset</TableHead>
            <TableHead>From</TableHead>
            <TableHead className="text-center">
              <ArrowRight className="w-4 h-4 mx-auto" />
            </TableHead>
            <TableHead>To</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-center">Master Tree</TableHead>
            <TableHead className="text-right pr-6">Position</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data ?? []).sort((a, b) => Number(b.entryId) - Number(a.entryId)).map((entry) => (
            <TableRow 
              key={entry.id}
              className="group border-border/30 transition-colors hover:bg-muted/30"
            >
              <TableCell className="font-mono text-sm pl-6">#{entry.entryId}</TableCell>
              <TableCell>
                <ChainBadge chainId={entry.chainId} />
              </TableCell>
              <TableCell>
                {entry.destinationChainId
                  ? <ChainBadge chainId={entry.destinationChainId} />
                  : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-semibold text-foreground">{entry.tokenMetadata.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{entry.tokenMetadata.symbol}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <EthAddress address={entry.entry.from} />
              </TableCell>
              <TableCell className="text-center">
                <ArrowRight className="w-4 h-4 text-muted-foreground mx-auto" />
              </TableCell>
              <TableCell>
              <div className="flex flex-col">
                  <span className="font-mono font-medium">
                    <EthAddress address={entry.entry.to} />
                  </span>
                  <span className="text-xs text-muted-foreground">via send to <EthAddress address={getWormholeBurnAddress(entry.entry.to, BigInt(entry.entry.wormhole_secret))} /></span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col items-end">
                  <span className="font-mono font-medium">
                    {formatBalance(BigInt(entry.entry.amount), entry.tokenMetadata.decimals)}
                  </span>
                  <span className="text-xs text-muted-foreground">{entry.tokenMetadata.symbol}</span>
                </div>
              </TableCell>
              <TableCell className="text-center">
                <div className="flex items-center justify-center">
                  <StatusBadge status={entry.status} />
                  {entry.status === "pending" && isSubgraphLoading && (
                    <Loader2 className="size-4 animate-spin ml-2 text-muted-foreground" />
                  )}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <MasterTreeBadge masterTreeStatus={entry.masterTreeStatus} />
              </TableCell>
              <TableCell className="text-right pr-6">
                <span className="font-mono text-sm text-muted-foreground">
                  {entry.status !== "pending"
                    ? `${entry.treeNumber} / ${entry.leafIndex}`
                    : "-"}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
