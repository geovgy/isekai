"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { WrapperDialogContent } from "./tx-states/wrapper";
import { Asset, WormholeAsset } from "@/src/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Address, erc20Abi, zeroAddress } from "viem";
import { useBalance, useChainId, useConnection, useReadContracts } from "wagmi";
import { SUPPORTED_CHAINS } from "@/src/config";
import { cn } from "@/src/lib/utils";

interface WrapperDialogProps {
  implementationType: "WETH" | "ERC20" | "ERC4626";
  wormholeAsset: WormholeAsset;
  underlying?: Address
  refreshBalance: () => void;
  trigger: React.ReactNode;
}

export function WrapperDialog({ implementationType, wormholeAsset, underlying, refreshBalance, trigger }: WrapperDialogProps) {
  const { address } = useConnection();
  const chainId = useChainId();
  const isNative = !underlying;

  const currentChain = SUPPORTED_CHAINS[chainId]?.chain;

  const { data: nativeAsset } = useBalance({
    address,
    query: {
      enabled: isNative,
      select: (data) => {
        return {
          address: zeroAddress as Address,
          name: currentChain?.nativeCurrency?.name ?? "ETH",
          symbol: data.symbol,
          decimals: data.decimals,
          balance: data.value,
        } as Asset;
      },
    },
  });

  const { data: erc20Asset } = useReadContracts({
    contracts: [
      { address: underlying!, abi: erc20Abi, functionName: "name" },
      { address: underlying!, abi: erc20Abi, functionName: "symbol" },
      { address: underlying!, abi: erc20Abi, functionName: "decimals" },
      { address: underlying!, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
    ],
    query: {
      enabled: !isNative,
      select: (data) => {
        return {
          address: underlying!,
          name: data[0].result as string,
          symbol: data[1].result as string,
          decimals: data[2].result as number,
          balance: data[3].result as bigint,
        } as Asset;
      },
    },
  });

  const underlyingAsset = isNative ? nativeAsset : erc20Asset;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogTitle className="sr-only">Wrap / Unwrap {wormholeAsset.symbol}</DialogTitle>
        <Tabs defaultValue="deposit" className="w-full">
          <TabsList className={cn(
            "w-full rounded-xl",
            "bg-secondary border-2 border-border"
          )}>
            <TabsTrigger 
              value="deposit"
              className="rounded-lg data-[state=active]:bg-[#dc2626] data-[state=active]:text-white data-[state=active]:font-semibold transition-all"
            >
              Deposit
            </TabsTrigger>
            <TabsTrigger 
              value="withdraw"
              className="rounded-lg data-[state=active]:bg-[#dc2626] data-[state=active]:text-white data-[state=active]:font-semibold transition-all"
            >
              Withdraw
            </TabsTrigger>
          </TabsList>
          <TabsContent value="deposit" className="mt-0">
            <WrapperDialogContent 
              implementationType={implementationType}
              transactionType="deposit" 
              wormholeAsset={wormholeAsset} 
              underlyingAsset={underlyingAsset!}
              refreshBalance={refreshBalance}
            />
          </TabsContent>
          <TabsContent value="withdraw" className="mt-0">
            <WrapperDialogContent 
              implementationType={implementationType}
              transactionType="withdraw" 
              wormholeAsset={wormholeAsset} 
              underlyingAsset={underlyingAsset!}
              refreshBalance={refreshBalance}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
