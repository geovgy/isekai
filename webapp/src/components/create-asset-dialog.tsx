"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/src/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWriteContract } from "wagmi";
import { Address, encodePacked, getAddress, isAddress, parseAbi } from "viem";
import { SHIELDED_POOL_CONTRACT_ADDRESS } from "@/src/env";
import { waitForTransactionReceipt } from "wagmi/actions";
import { useConfig as useWagmiConfig } from "wagmi";
// TODO: Asset creation is no longer in ShieldedPool contract - this dialog needs redesign
import { cn } from "@/src/lib/utils";

type ImplementationType = "ERC20" | "ERC4626";

export function CreateAssetDialog({ trigger }: { trigger: React.ReactNode }) {
  const { mutateAsync: writeContract, isPending } = useWriteContract();
  const wagmiConfig = useWagmiConfig()
  const refetchWormholeAssets = () => {} // TODO: removed entity
  
  const [implementationType, setImplementationType] = useState<ImplementationType>("ERC20");
  const [tokenAddress, setTokenAddress] = useState<`0x${string}` | "">("");
  const [vaultAddress, setVaultAddress] = useState<`0x${string}` | "">("");
  const [open, setOpen] = useState(false);

  const implementationAddresses: Record<ImplementationType, Address> = {
    ERC20: "0x0000000000000000000000000000000000000000" as Address, // TODO: update with actual addresses
    ERC4626: "0x0000000000000000000000000000000000000000" as Address,
  };

  async function handleSubmit() {
    if (!tokenAddress.trim()) {
      toast.error("Please enter a token address");
      return;
    }

    if (!isAddress(tokenAddress)) {
      toast.error("Invalid token address");
      return;
    }

    if (implementationType === "ERC4626" && !vaultAddress.trim()) {
      toast.error("Please enter a vault address for ERC4626 implementation");
      return;
    }

    if (implementationType === "ERC4626" && vaultAddress.trim() && !isAddress(vaultAddress)) {
      toast.error("Invalid vault address");
      return;
    }

    let initData: `0x${string}`;
    
    if (implementationType === "ERC20") {
      initData = encodePacked(["address"], [getAddress(tokenAddress)]);
    } else {
      initData = encodePacked(
        ["address", "address"],
        [getAddress(tokenAddress), getAddress(vaultAddress)]
      );
    }

    const hash = await writeContract(
      {
        address: SHIELDED_POOL_CONTRACT_ADDRESS as Address,
        abi: parseAbi(["function createWormholeAsset(address implementation, bytes calldata initData) external returns (address asset)"]),
        functionName: "createWormholeAsset",
        args: [implementationAddresses[implementationType], initData],
      },
      {
        onSuccess: (hash) => {
          toast.success(`Waiting for transaction to be confirmed...`);
          setOpen(false);
          setTokenAddress("");
          setVaultAddress("");
        },
        onError: (error) => {
          toast.error(error.message || "Failed to create asset");
        },
      }
    );

    const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
    if (receipt.status === "success") {
      toast.success(`Asset created successfully`);
      refetchWormholeAssets();
    } else {
      toast.error(`Failed to create asset`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="mb-4">
          <DialogTitle>Create New Asset</DialogTitle>
          <DialogDescription>
            Deploy a new wormhole asset wrapper for an ERC20 or ERC4626 token.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Implementation type selection */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Implementation Type</label>
            <RadioGroup
              value={implementationType}
              onValueChange={(v) => {
                setImplementationType(v as ImplementationType);
                setVaultAddress("");
              }}
              className="grid grid-cols-2 gap-2"
            >
              <label
                htmlFor="erc20-radio"
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium border-2 transition-all",
                  implementationType === "ERC20"
                    ? "bg-[#0d9488] text-white border-[#0d9488]"
                    : "bg-background text-foreground border-border hover:border-[#0d9488]/50"
                )}
              >
                <RadioGroupItem id="erc20-radio" value="ERC20" className="sr-only" />
                ERC20
              </label>
              <label
                htmlFor="erc4626-radio"
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium border-2 transition-all",
                  implementationType === "ERC4626"
                    ? "bg-[#0d9488] text-white border-[#0d9488]"
                    : "bg-background text-foreground border-border hover:border-[#0d9488]/50"
                )}
              >
                <RadioGroupItem id="erc4626-radio" value="ERC4626" className="sr-only" />
                ERC4626
              </label>
            </RadioGroup>
          </div>

          {/* Token address input */}
          <div className="space-y-2">
            <label htmlFor="token-address" className="text-sm font-semibold text-foreground">
              {implementationType === "ERC4626" ? "Underlying Token Address" : "Token Address"}
            </label>
            <Input
              id="token-address"
              placeholder="0x..."
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value as `0x${string}`)}
              className="border-2 border-border focus:border-[#0d9488] focus-visible:ring-[#0d9488]/20"
            />
          </div>

          {/* Vault address input - only for ERC4626 */}
          {implementationType === "ERC4626" && (
            <div className="space-y-2">
              <label htmlFor="vault-address" className="text-sm font-semibold text-foreground">Vault Address</label>
              <Input
                id="vault-address"
                placeholder="0x..."
                value={vaultAddress}
                onChange={(e) => setVaultAddress(e.target.value as `0x${string}`)}
                className="border-2 border-border focus:border-[#0d9488] focus-visible:ring-[#0d9488]/20"
              />
            </div>
          )}

          {/* Submit button */}
          <DialogFooter>
            <Button
              onClick={handleSubmit}
              disabled={isPending}
              size="lg"
              className="w-full"
            >
              {isPending && <Loader2 className="size-4 animate-spin mr-2" />}
              Create Asset
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
