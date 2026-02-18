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
import { useConnection, useReadContracts } from "wagmi";
import { Abi, Address, erc20Abi, formatUnits, getAddress } from "viem";
import { useMemo } from "react";
import { useShieldedBalances } from "@/src/hooks/use-shieldedpool";
import { cn } from "@/src/lib/utils";
import { WORMHOLE_TOKENS, WORMHOLE_TOKEN_TYPES } from "@/src/env";
import { WormholeTokenType } from "@/src/types";

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

function getTypeBadgeStyle(tokenType: WormholeTokenType) {
  switch (tokenType) {
    case "WETH":
      return "bg-[#f97316]/10 text-[#f97316]";
    case "ERC4626":
    case "wERC4626":
      return "bg-[#1a1a1a]/10 text-[#1a1a1a]";
    default:
      return "bg-[#dc2626]/10 text-[#dc2626]";
  }
}

function getImplementationType(tokenType: WormholeTokenType): "WETH" | "ERC20" | "ERC4626" {
  switch (tokenType) {
    case "WETH": return "WETH";
    case "ERC4626":
    case "wERC4626": return "ERC4626";
    default: return "ERC20";
  }
}

export function AssetsTable() {
  const { address } = useConnection();

  const tokenList = useMemo(() =>
    WORMHOLE_TOKENS.map((token, i) => ({
      address: getAddress(token),
      tokenType: WORMHOLE_TOKEN_TYPES[i] ?? "ERC20" as WormholeTokenType,
    })),
    [],
  );

  const { data: shieldedBalances, refetch: refetchShieldedBalances } = useShieldedBalances({
    tokens: tokenList.map(t => t.address),
    excludeWormholes: false,
  });

  const contractCalls = useMemo(() =>
    tokenList.flatMap(t => [
      { address: t.address, abi: erc20Abi, functionName: "name" },
      { address: t.address, abi: erc20Abi, functionName: "symbol" },
      { address: t.address, abi: erc20Abi, functionName: "decimals" },
      ...(address
        ? [{ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }]
        : []),
    ]),
    [tokenList, address],
  );

  const callsPerToken = address ? 4 : 3;

  const { data: metadatas, refetch } = useReadContracts({
    query: {
      enabled: tokenList.length > 0,
      select: (data) => data.map(d => d.result),
    },
    allowFailure: true,
    contracts: contractCalls,
  });

  const tokens = useMemo(() =>
    tokenList.map((token, i) => {
      const offset = i * callsPerToken;
      const name = metadatas?.[offset] as string ?? "Loading...";
      const symbol = metadatas?.[offset + 1] as string ?? "-";
      const decimals = Number(metadatas?.[offset + 2] as bigint ?? 18);
      const publicBalance = address ? (metadatas?.[offset + 3] as bigint ?? 0n) : 0n;
      const privateBalance = shieldedBalances?.[i] as bigint ?? 0n;
      const implType = getImplementationType(token.tokenType);

      return {
        address: token.address,
        tokenType: token.tokenType,
        implementationType: implType,
        metadata: {
          address: token.address,
          name,
          symbol,
          decimals,
          balance: publicBalance,
          implementation: token.address,
        },
        balances: {
          publicBalance,
          privateBalance,
        },
        underlying: implType !== "WETH" ? token.address : undefined,
      };
    }),
    [tokenList, metadatas, shieldedBalances, callsPerToken, address],
  );

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
          {tokens.map((asset) => (
            <TableRow 
              key={asset.address}
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
                  getTypeBadgeStyle(asset.tokenType),
                )}>
                  {asset.tokenType}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <BalanceDisplay 
                  amount={asset.balances.publicBalance} 
                  decimals={asset.metadata.decimals} 
                  symbol={asset.metadata.symbol}
                />
              </TableCell>
              <TableCell className="text-right">
                <BalanceDisplay 
                  amount={asset.balances.privateBalance} 
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
                    balances={asset.balances}
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
