"use client";

import { useState } from "react";
import { Button } from "@/src/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Loader2, GitMerge, Check } from "lucide-react";
import { toast } from "sonner";
import { parseAbi } from "viem";
import { useConfig as useWagmiConfig } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { SUPPORTED_CHAINS, SUPPORTED_CHAIN_IDS, MASTER_CHAIN_ID } from "@/src/config";
import { SHIELDED_POOL_CONTRACT_ADDRESS } from "@/src/env";
import { queryLatestBranchTreesUpdated } from "@/src/subgraph-queries";
import { getPolymerProofHex } from "@/src/polymer";
import { Address } from "viem";

const BRANCH_CHAIN_IDS = SUPPORTED_CHAIN_IDS.filter((id) => id !== MASTER_CHAIN_ID);

type SyncStatus = "idle" | "querying" | "proving" | "sending" | "confirming" | "success" | "error";

const statusLabels: Record<SyncStatus, string> = {
  idle: "Sync to Master",
  querying: "Fetching branch root…",
  proving: "Requesting Polymer proof…",
  sending: "Sign in wallet…",
  confirming: "Confirming tx…",
  success: "Synced!",
  error: "Failed",
};

export function SyncMasterTree() {
  const wagmiConfig = useWagmiConfig();

  const [chainId, setChainId] = useState<number | undefined>(
    BRANCH_CHAIN_IDS[0]
  );
  const [status, setStatus] = useState<SyncStatus>("idle");

  const busy = status !== "idle" && status !== "success" && status !== "error";

  async function handleSync() {
    if (!chainId) return;

    try {
      setStatus("querying");
      const latest = await queryLatestBranchTreesUpdated({ chainId });
      if (!latest) {
        toast.error("No branch root updates found on this chain");
        setStatus("idle");
        return;
      }

      toast.info(
        `Found branch root at block ${latest.blockNumber} (log ${latest.logIndex})`
      );

      setStatus("proving");
      const proof = await getPolymerProofHex({
        sourceChainId: chainId,
        blockNumber: Number(latest.blockNumber),
        logIndex: Number(latest.logIndex),
      });

      toast.info("Polymer proof received, submitting transaction…");

      setStatus("sending");
      const hash = await writeContract(wagmiConfig, {
        chainId: MASTER_CHAIN_ID,
        address: SHIELDED_POOL_CONTRACT_ADDRESS as Address,
        abi: parseAbi([
          "function updateMasterTrees(bytes calldata proof) external",
        ]),
        functionName: "updateMasterTrees",
        args: [proof],
      });

      setStatus("confirming");
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });

      if (receipt.status === "success") {
        setStatus("success");
        toast.success("Master tree updated successfully!");
        setTimeout(() => setStatus("idle"), 3000);
      } else {
        setStatus("error");
        toast.error("Transaction reverted");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch (err) {
      console.error(err);
      setStatus("error");
      toast.error(
        err instanceof Error ? err.message : "Failed to sync branch root"
      );
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        value={chainId?.toString()}
        onValueChange={(v) => setChainId(Number(v))}
        disabled={busy}
      >
        <SelectTrigger className="w-[200px] h-10 rounded-xl border-2 border-border bg-background">
          <SelectValue placeholder="Select branch chain" />
        </SelectTrigger>
        <SelectContent>
          {BRANCH_CHAIN_IDS.map((id) => (
            <SelectItem key={id} value={id.toString()}>
              {SUPPORTED_CHAINS[id].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        onClick={handleSync}
        disabled={!chainId || busy}
        className="gap-2"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : status === "success" ? (
          <Check className="size-4" />
        ) : (
          <GitMerge className="size-4" />
        )}
        {statusLabels[status]}
      </Button>
    </div>
  );
}
