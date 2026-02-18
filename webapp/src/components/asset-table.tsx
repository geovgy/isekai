"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { Button } from "@/src/components/ui/button";
import { WrapperDialog } from "@/src/components/wrapper-dialog";
import { TransferDialog } from "@/src/components/transfer-dialog";
import { ArrowUpRightIcon, Wallet, Eye, EyeOff } from "lucide-react";
// TODO: useWormholeAssets was removed - asset discovery needs redesign
import { useConnection, useReadContracts } from "wagmi";
import { Abi, Address, erc20Abi, erc4626Abi, formatUnits, getAddress, isAddressEqual, parseAbi } from "viem";
import { useMemo } from "react";
// TODO: Implementation addresses removed from env - needs redesign
import { useShieldedBalances } from "@/src/hooks/use-shieldedpool";
import { cn } from "@/src/lib/utils";


function BalanceDisplay({ amount, decimals, symbol }: { amount: bigint; decimals: number; symbol: string }) {
  const formatted = formatUnits(amount, decimals)
  const isZero = amount === 0n
  
  return (
    <div className="flex flex-col items-end">
      <span className={cn(
        "font-mono text-sm font-medium",
        isZero ? "text-muted-foreground" : "text-foreground"
      )}>
        {parseFloat(formatted).toLocaleString(undefined, { maximumFractionDigits: 6 })}
      </span>
      <span className="text-xs text-muted-foreground">{symbol}</span>
    </div>
  )
}

export function AssetsTable() {
  const { address } = useConnection();

  const wormholeAssets: { asset: Address; implementation: { address: Address } }[] = []; // TODO: asset discovery removed

  const { data: shieldedBalances, refetch: refetchShieldedBalances } = useShieldedBalances({ tokens: wormholeAssets.map((asset) => asset.asset), excludeWormholes: false });

  const { data: metadatas, refetch } = useReadContracts({
    query: {
      enabled: !!wormholeAssets.length,
      select: (data) => {
        return data.map((d) => d.result);
      },
    },
    allowFailure: true,
    contracts: wormholeAssets.map((asset) => {
      const implementationType = getImplementationType(asset.implementation.address);
      const calls = [
        {
          address: getAddress(asset.asset),
          abi: erc20Abi as Abi,
          functionName: "name",
        },
        {
          address: getAddress(asset.asset),
          abi: erc20Abi as Abi,
          functionName: "symbol",
        },
        {
          address: getAddress(asset.asset),
          abi: erc20Abi as Abi,
          functionName: "decimals",
        },
        {
          address: getAddress(asset.asset),
          abi: erc20Abi as Abi,
          functionName: "balanceOf",
          args: [address],
        }
      ]
      if (implementationType === "ERC20") {
        calls.push({
          address: getAddress(asset.asset),
          abi: parseAbi(["function underlying() external view returns (address)"]),
          functionName: "underlying",
        })
      } else if (implementationType === "ERC4626") {
        calls.push({
          address: getAddress(asset.asset),
          abi: erc4626Abi,
          functionName: "asset",
          args: [address],
        })
      }
      return calls
    }).flat(),
  });

  const tokens = useMemo(() => {
    let offset = 0;
    return wormholeAssets.map((asset, i) => {
      const startIndex = offset;
      const implementationType = getImplementationType(asset.implementation.address)!;
      if (implementationType !== "WETH") {
        offset += 5;
      } else {
        offset += 4;
      }

      return {
        ...asset,
        metadata: {
          address: asset.asset,
          name: metadatas?.[startIndex] as string ?? "Unable to resolve name",
          symbol: metadatas?.[startIndex + 1] as string ?? "-",
          decimals: Number(metadatas?.[startIndex + 2] as bigint ?? 18),
          balance: metadatas?.[startIndex + 3] as bigint ?? 0n,
          implementation: asset.implementation.address
        },
        wormholeBalances: {
          publicBalance: metadatas?.[startIndex + 3] as bigint ?? 0n,
          privateBalance: shieldedBalances?.[i] as bigint ?? 0n,
        },
        underlying: implementationType !== "WETH" ? metadatas?.[startIndex + 4] as Address : undefined,
        implementationType,
      }
    }).filter((asset) => asset.implementationType !== undefined);
  }, [wormholeAssets, metadatas]);

  function getImplementationType(_implementation: Address) {
    return "ERC20" as const; // TODO: implementation type detection removed - needs redesign
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead className="w-[280px] pl-6">Asset</TableHead>
            <TableHead className="text-center">Type</TableHead>
            <TableHead className="text-right">
              <div className="flex items-center justify-end gap-2">
                <Eye className="w-4 h-4 text-muted-foreground" />
                Public Balance
              </div>
            </TableHead>
            <TableHead className="text-right">
              <div className="flex items-center justify-end gap-2">
                <EyeOff className="w-4 h-4 text-muted-foreground" />
                Private Balance
              </div>
            </TableHead>
            <TableHead className="text-right pr-6">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((asset, index) => (
            <TableRow 
              key={asset.id}
              className="group border-border/30 transition-colors hover:bg-muted/30"
            >
              <TableCell className="pl-6">
                <div className="flex items-center gap-4">
                  <div>
                    <p className="font-semibold text-foreground">{asset.metadata.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{asset.metadata.symbol}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-center">
                <span className={cn(
                  "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
                  asset.implementationType === "WETH" && "bg-[#f97316]/10 text-[#f97316]",
                  asset.implementationType === "ERC20" && "bg-[#dc2626]/10 text-[#dc2626]",
                  asset.implementationType === "ERC4626" && "bg-[#1a1a1a]/10 text-[#1a1a1a]",
                )}>
                  {asset.implementationType}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <BalanceDisplay 
                  amount={asset.wormholeBalances.publicBalance} 
                  decimals={asset.metadata.decimals} 
                  symbol={asset.metadata.symbol}
                />
              </TableCell>
              <TableCell className="text-right">
                <BalanceDisplay 
                  amount={asset.wormholeBalances.privateBalance} 
                  decimals={asset.metadata.decimals} 
                  symbol={asset.metadata.symbol}
                />
              </TableCell>
              <TableCell className="text-right pr-6">
                <div className="flex items-center justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                  <WrapperDialog
                    implementationType={asset.implementationType}
                    wormholeAsset={asset.metadata}
                    underlying={asset.underlying}
                    refreshBalance={() => {
                      refetch();
                      refetchShieldedBalances();
                    }}
                    trigger={
                      <Button variant="pill" size="sm">
                        <Wallet className="w-4 h-4 mr-1.5" />
                        Manage
                      </Button>
                    }
                  />
                  <TransferDialog
                    wormholeAsset={asset.metadata}
                    balances={asset.wormholeBalances}
                    refetchBalances={() => {
                      refetch();
                      refetchShieldedBalances();
                    }}
                    trigger={
                      <Button variant="pill" size="sm">
                        <ArrowUpRightIcon className="w-4 h-4 mr-1" />
                        Send
                      </Button>
                    }
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
