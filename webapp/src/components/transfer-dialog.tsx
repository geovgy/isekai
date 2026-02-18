// UI to send a wormhole and shielded transfer
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/src/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { useProve } from "@/src/hooks/use-zk-provers";
import { WormholeAsset, BalanceInfo, ShieldedTxStringified } from "@/src/types";
import { Loader2, Shield, Globe, Sparkles, Eye, EyeOff, Wallet, Network } from "lucide-react";
import { toast } from "sonner";
import { useChainId, useConfig as useWagmiConfig, useConnection, useReadContract, useSwitchChain } from "wagmi";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseUnits, toHex } from "viem";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { mainnet } from "viem/chains";
import { useShieldedPool } from "@/src/hooks/use-shieldedpool";
import { useQuery } from "@tanstack/react-query";
import { getEnsAddress, getEnsName } from "viem/actions";
import { formatBalance } from "@/src/lib/utils"
import { formatAddress } from "@/src/components/address"
import { cn } from "@/src/lib/utils";
import { SUPPORTED_CHAINS, SUPPORTED_CHAIN_IDS } from "@/src/config";

type BalanceSource = "private" | "public";

export function TransferDialog({ trigger, wormholeAsset, balances, refetchBalances }: { trigger: React.ReactNode, wormholeAsset: WormholeAsset, balances: BalanceInfo, refetchBalances: () => void }) {
  const { privateBalance } = balances;
  const { mutateAsync: prove } = useProve("utxo_2x2");

  const wagmiConfig = useWagmiConfig();
  const { data: shieldedPool } = useShieldedPool();
  const { address } = useConnection();
  const walletChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [sourceChainId, setSourceChainId] = useState<number>(walletChainId);
  
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [amountInput, setAmountInput] = useState("");
  const [fundsSource, setFundsSource] = useState<BalanceSource>("private");
  const [fundsDestination, setFundsDestination] = useState<BalanceSource>("private");
  const [destinationChainId, setDestinationChainId] = useState<number>(walletChainId);

  useEffect(() => {
    setSourceChainId(walletChainId);
  }, [walletChainId]);

  function handleSourceChainChange(newChainId: number) {
    setSourceChainId(newChainId);
    switchChain({ chainId: newChainId });
  }

  const { data: publicBalance = 0n } = useReadContract({
    address: wormholeAsset.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address!],
    chainId: sourceChainId,
    query: { enabled: !!address },
  });

  const [status, setStatus] = useState<undefined | "signing" | "executing" | "confirming" | "success" | "error">(undefined);

  const isLoading = useMemo(() => {
    return status === "signing" || status === "executing" || status === "confirming";
  }, [status]);

  const { data: recipient } = useQuery({
    queryKey: ["ens-resolution", recipientInput.trim()],
    queryFn: async () => {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(mainnet.rpcUrls.default.http[0]),
      });
      const rec = recipientInput.trim();
      const result = {
        address: isAddress(rec) ? getAddress(rec) : undefined,
        name: rec.endsWith(".eth") ? rec : undefined,
        resolved: false,
      }
      if (result.address) {
        try {
          const ensName = await getEnsName(client, {
            address: result.address,
          });
          result.name = ensName ?? undefined;
          result.resolved = true;
        } catch (error) {}
      }
      if (result.name && !result.address) {
        try {
          const ensAddress = await getEnsAddress(client, {
            name: result.name,
          });
          result.address = ensAddress ?? undefined;
          result.resolved = true;
        } catch (error) {}
      }

      return result;
    },
    enabled: !!recipientInput.trim(),
  });

  const parsedAmount = useMemo(() => {
    return parseUnits(amountInput.trim(), wormholeAsset.decimals);
  }, [amountInput, wormholeAsset.decimals]);

  const txType = useMemo<"wormhole" | "shielded" | "unshield" | "public">(() => {
    if (fundsSource === "public" && fundsDestination === "private") {
      return "wormhole";
    } else if (fundsSource === "private" && fundsDestination === "public") {
      return "unshield";
    } else if (fundsSource === "public" && fundsDestination === "public") {
      return "public";
    } else {
      return "shielded";
    }
  }, [fundsSource, fundsDestination]);

  const showChainSelector = txType === "wormhole" || txType === "shielded";
  
  const transferDescription = useMemo(() => {
    if (!recipient?.address && !amountInput.trim()) {
      return "Enter recipient and amount to continue";
    }
    if (!recipient?.address) {
      return "Enter a valid recipient address";
    }
    if (!amountInput.trim()) {
      return "Enter an amount to send";
    }
    const recipientName = recipient.name ?? formatAddress(recipient.address);
    const sourceLabel = SUPPORTED_CHAINS[sourceChainId]?.label ?? "Unknown";
    const destLabel = SUPPORTED_CHAINS[destinationChainId]?.label ?? "Unknown";
    if (txType === "wormhole") {
      return `Shield ${amountInput} ${wormholeAsset.symbol} from ${sourceLabel} to ${recipientName} on ${destLabel} via zk-wormhole`;
    } else if (txType === "unshield") {
      return `Unshield ${amountInput} ${wormholeAsset.symbol} to ${recipientName} on ${sourceLabel}`;
    } else if (txType === "public") {
      return `Send ${amountInput} ${wormholeAsset.symbol} to ${recipientName} on ${sourceLabel}`;
    } else {
      return `Send ${amountInput} ${wormholeAsset.symbol} to ${recipientName} on ${destLabel} via shielded transfer`;
    }
  }, [recipient, amountInput, txType, wormholeAsset.symbol, sourceChainId, destinationChainId]);

  async function handleTransaction() {
    switch(txType) {
      case "wormhole":
        await handleWormholeTransaction();
        break;
      case "unshield":
        await handleShieldedTransaction({ unshield: true });
        break;
      case "public":
        await handlePublicTransaction();
        break;
      case "shielded":
        await handleShieldedTransaction();
        break;
    }
  }

  async function handleWormholeTransaction() {
    try {
      if (!recipient?.address) {
        throw new Error("Invalid recipient address");
      }
      const client = wagmiConfig.getClient();
      if (!client) {
        throw new Error("Client not found");
      }
      if (!shieldedPool) {
        throw new Error("Shielded pool not found");
      }
      setStatus("signing");
      const { hash, wormholeSecret, burnAddress } = await shieldedPool.wormholeTransfer(wagmiConfig, {
        chainId: destinationChainId,
        to: recipient.address,
        tokenType: "erc20",
        token: wormholeAsset.address,
        tokenId: 0n,
        amount: parsedAmount,
      });
      setStatus("confirming");
      toast.info(`Waiting for transaction to be confirmed...`);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      if (receipt.status === "success") {
        setStatus("success");
        const entry = await shieldedPool.parseAndSaveWormholeEntry({
          srcChainId: sourceChainId,
          dstChainId: destinationChainId,
          receiver: recipient.address,
          wormholeSecret: wormholeSecret,
          receipt: receipt,
        });
        toast.success(`Transaction confirmed! Entry ID: ${entry.id}`);
        refetchBalances();
      } else {
        setStatus("error");
        toast.error("Transaction failed");
      }
    } catch (error) {
      console.error(error);
      setStatus("error");
      toast.error("Transaction failed");
    }
    setStatus(undefined);
  }

  async function handlePublicTransaction() {
    try {
      if (!recipient?.address) {
        throw new Error("Invalid recipient address");
      }
      const hash = await writeContract(wagmiConfig, {
        address: wormholeAsset.address,
        abi: erc20Abi, // TODO: Use dynamic ABI based on asset type
        functionName: "transfer",
        args: [recipient.address, parsedAmount],
      });
      setStatus("confirming");
      toast.info(`Waiting for transaction to be confirmed...`);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      if (receipt.status === "success") {
        setStatus("success");
        toast.success(`Transaction confirmed!`);
        refetchBalances();
      } else {
        setStatus("error");
        toast.error("Transaction failed");
      }
    } catch (error) {
      console.error(error);
      setStatus("error");
      toast.error("Transaction failed");
    }
    setStatus(undefined);
  }

  async function handleShieldedTransaction({ unshield }: { unshield: boolean } = { unshield: false }) {
    try {
      if (!recipient?.address) {
        throw new Error("Invalid recipient address");
      }
      const client = wagmiConfig.getClient();
      if (!client) {
        throw new Error("Client not found");
      }
      if (!shieldedPool) {
        throw new Error("Shielded pool not found");
      }

      setStatus("signing");
      const { circuitInputs, entries, outputNotes, typedData, messageHash } = await shieldedPool.signShieldedTransfer(wagmiConfig, {
        srcChainId: sourceChainId,
        dstChainId: destinationChainId,
        receiver: recipient.address,
        token: wormholeAsset.address,
        tokenId: 0n,
        amount: parsedAmount,
        unshield,
      });
      
      // Generate UTXO proof
      console.log("Proving...");
      const proofData = await prove(circuitInputs);

      // Stringify ShieldedTx
      const shieldedTx: ShieldedTxStringified = {
        chainId: typedData.message.chainId.toString(),
        wormholeRoot: typedData.message.wormholeRoot,
        wormholeNullifier: typedData.message.wormholeNullifier,
        shieldedRoot: typedData.message.shieldedRoot,
        nullifiers: typedData.message.nullifiers,
        commitments: typedData.message.commitments.map(commitment => commitment.toString()),
        withdrawals: typedData.message.withdrawals.map(withdrawal => ({
          to: withdrawal.to,
          asset: withdrawal.asset,
          id: withdrawal.id.toString(),
          amount: withdrawal.amount.toString(),
        })),
      };

      console.log("Message hash:", messageHash);
      
      // Call relayer to execute transaction
      const response = await fetch("/api/shielded-relay", {
        method: "POST",
        body: JSON.stringify({ shieldedTx, proof: toHex(proofData.proof), chainId: sourceChainId }),
      });
      if (!response.ok) {
        throw new Error("Failed to relay shielded transfer");
      }
      const { hash, error } = await response.json() as { hash: `0x${string}`, error?: string };
      if (error) {
        throw new Error(error);
      } 

      // Wait for transaction to be confirmed
      setStatus("confirming");
      toast.info(`Waiting for transaction to be confirmed...`);
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
      
      // Update notes and balances
      if (receipt.status === "success") {
        const result = await shieldedPool.parseAndSaveShieldedTransfer({
          srcChainId: sourceChainId,
          token: wormholeAsset.address,
          tokenId: 0n,
          receipt,
          entries,
          outputNotes,
        });
        toast.success(`Shielded transfer confirmed!`);
        setStatus("success");
        refetchBalances();
      } else {
        setStatus("error");
        toast.error("Transaction failed");
      }
    } catch (error) {
      console.error(error);
      setStatus("error");
      toast.error("Transaction failed");
    }
    setStatus(undefined);
  }

  const getTxTypeIcon = () => {
    switch(txType) {
      case "wormhole": return <Shield className="w-4 h-4 text-white" />;
      case "shielded": return <EyeOff className="w-4 h-4 text-white" />;
      case "unshield": return <Eye className="w-4 h-4 text-white" />;
      case "public": return <Globe className="w-4 h-4 text-white" />;
    }
  };

  const getTxTypeColor = () => {
    switch(txType) {
      case "wormhole": return "bg-[#dc2626]";
      case "shielded": return "bg-[#f97316]";
      case "unshield": return "bg-[#b91c1c]";
      case "public": return "bg-[#1a1a1a]";
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        {/* Header */}
        
        <DialogHeader className="mb-6">
          <div className="flex items-center gap-3">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", getTxTypeColor())}>
              {getTxTypeIcon()}
            </div>
            <div>
              <DialogTitle className="text-xl">Send {wormholeAsset.symbol}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Source Chain Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5 text-[#dc2626]" />
              Source Chain
            </label>
            <Select
              value={sourceChainId.toString()}
              onValueChange={(v) => handleSourceChainChange(Number(v))}
            >
              <SelectTrigger className="h-12 rounded-xl border-2 border-border bg-background focus:border-[#dc2626] transition-all">
                <SelectValue placeholder="Select chain" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CHAIN_IDS.map((id) => (
                  <SelectItem key={id} value={id.toString()}>
                    {SUPPORTED_CHAINS[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount Section */}
          <div >
            <label className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Wallet className="w-4 h-4 text-[#dc2626]" />
              Amount
            </label>
            <div className="relative">
              <InputGroup className="h-16 rounded-2xl bg-background border-2 border-border focus-within:border-[#dc2626] transition-all">
                <InputGroupInput
                  type="text"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value.replace(/[^0-9.]/g, ""));
                  }}
                  className="text-right text-3xl font-bold focus:text-foreground placeholder:text-muted-foreground/50"
                />
                <InputGroupAddon
                  align="inline-end"
                  className="pr-5 w-24 text-left justify-start"
                >
                  <span className="font-bold text-foreground text-lg">{wormholeAsset.symbol}</span>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <div className="flex justify-between items-center px-2">
              <span className="text-xs text-muted-foreground">
                Balance: {formatBalance(fundsSource === "public" ? publicBalance : privateBalance, wormholeAsset.decimals)} {wormholeAsset.symbol}
              </span>
              <Button 
                variant="ghost" 
                size="xs" 
                onClick={() => {
                  const balance = fundsSource === "public" ? publicBalance : privateBalance;
                  setAmountInput(formatUnits(balance, wormholeAsset.decimals));
                }}
                className="text-xs font-semibold text-[#dc2626] hover:text-[#b91c1c]"
              >
                Max
              </Button>
            </div>
          </div>

          {/* Recipient Section */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground">Recipient</label>
            <Input
              placeholder="0x... or ENS name"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              className="h-14 rounded-xl border-2 border-border bg-background focus:border-[#dc2626] transition-all"
            />
            {recipient?.resolved && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#dc2626]/10 text-[#dc2626] text-sm border border-[#dc2626]/20">
                <Sparkles className="w-4 h-4" />
                <span>{recipient.name || formatAddress(recipient.address!)}</span>
              </div>
            )}
          </div>

          {/* Transfer Direction */}
          <div className="space-y-3">
            {/* Source */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">From</label>
              <RadioGroup value={fundsSource} onValueChange={(v) => setFundsSource(v as BalanceSource)} className="grid grid-cols-2 gap-2">
                <label
                  htmlFor="source-private"
                  className={cn(
                    "flex items-center gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200",
                    fundsSource === "private"
                      ? "border-[#dc2626] bg-[#fef2f2]"
                      : "border-border bg-background hover:border-muted-foreground/30"
                  )}
                >
                  <RadioGroupItem value="private" id="source-private" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <EyeOff className="w-3.5 h-3.5 text-[#dc2626]" />
                      <span className="font-semibold text-sm text-foreground">Private</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatBalance(privateBalance, wormholeAsset.decimals)} {wormholeAsset.symbol}
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="source-public"
                  className={cn(
                    "flex items-center gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200",
                    fundsSource === "public"
                      ? "border-[#f97316] bg-[#fff7ed]"
                      : "border-border bg-background hover:border-muted-foreground/30"
                  )}
                >
                  <RadioGroupItem value="public" id="source-public" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-[#f97316]" />
                      <span className="font-semibold text-sm text-foreground">Public</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatBalance(publicBalance, wormholeAsset.decimals)} {wormholeAsset.symbol}
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {/* Destination */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider">To</label>
              <RadioGroup value={fundsDestination} onValueChange={(v) => setFundsDestination(v as BalanceSource)} className="grid grid-cols-2 gap-2">
                <label
                  htmlFor="dest-private"
                  className={cn(
                    "flex items-center gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200",
                    fundsDestination === "private"
                      ? "border-[#dc2626] bg-[#fef2f2]"
                      : "border-border bg-background hover:border-muted-foreground/30"
                  )}
                >
                  <RadioGroupItem value="private" id="dest-private" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <EyeOff className="w-3.5 h-3.5 text-[#dc2626]" />
                      <span className="font-semibold text-sm text-foreground">Private</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Shielded</p>
                  </div>
                </label>
                <label
                  htmlFor="dest-public"
                  className={cn(
                    "flex items-center gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200",
                    fundsDestination === "public"
                      ? "border-[#f97316] bg-[#fff7ed]"
                      : "border-border bg-background hover:border-muted-foreground/30"
                  )}
                >
                  <RadioGroupItem value="public" id="dest-public" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5 text-[#f97316]" />
                      <span className="font-semibold text-sm text-foreground">Public</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Standard</p>
                  </div>
                </label>
              </RadioGroup>
            </div>
          </div>

          {/* Destination Chain Selector (only for wormhole and shielded) */}
          {showChainSelector && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-[#dc2626]" />
                Destination Chain
              </label>
              <Select
                value={destinationChainId.toString()}
                onValueChange={(v) => setDestinationChainId(Number(v))}
              >
                <SelectTrigger className="h-12 rounded-xl border-2 border-border bg-background focus:border-[#dc2626] transition-all">
                  <SelectValue placeholder="Select chain" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CHAIN_IDS.map((id) => (
                    <SelectItem key={id} value={id.toString()}>
                      {SUPPORTED_CHAINS[id].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Summary */}
          <div className="p-4 rounded-xl bg-secondary border-2 border-border space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Transfer Type</span>
              <span className="font-medium flex items-center gap-1.5">
                <span className={cn("w-5 h-5 rounded-md flex items-center justify-center", getTxTypeColor())}>
                  {getTxTypeIcon()}
                </span>
                <span className="text-foreground">{txType.charAt(0).toUpperCase() + txType.slice(1)}</span>
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Source</span>
              <span className="font-medium text-foreground">{SUPPORTED_CHAINS[sourceChainId]?.label}</span>
            </div>
            {showChainSelector && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Destination</span>
                <span className="font-medium text-foreground">{SUPPORTED_CHAINS[destinationChainId]?.label}</span>
              </div>
            )}
            {amountInput && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold text-foreground">{amountInput} {wormholeAsset.symbol}</span>
              </div>
            )}
          </div>

          {/* Send button */}
          <DialogFooter className="!flex-col gap-3 sm:!flex-col">
            <p className="text-xs text-center text-muted-foreground">
              {transferDescription}
            </p>
            <Button
              onClick={handleTransaction}
              disabled={isLoading || !recipient?.address || !amountInput}
              size="lg"
              className="w-full h-14 text-base rounded-xl"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  {status === "signing" ? "Sign in wallet..." : status === "confirming" ? "Confirming..." : "Processing..."}
                </>
              ) : (
                <>
                  Send
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}