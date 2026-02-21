"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/src/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/src/components/ui/input-group";
import { Loader2, ArrowDown } from "lucide-react";
import { Abi, erc4626Abi, formatUnits, parseAbi, parseUnits } from "viem";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "viem/actions";
import { toast } from "sonner";
import { Asset, WormholeAsset } from "@/src/types";
import { formatBalance } from "@/src/lib/utils";

export interface WrapperDialogContentProps {
  transactionType: "deposit" | "withdraw";
  wormholeAsset: WormholeAsset;
  underlyingAsset: Asset;
  implementationType: "WETH" | "ERC20" | "ERC4626";
  refreshBalance: () => void;
}

export function WrapperDialogContent({ transactionType, implementationType, wormholeAsset, underlyingAsset, refreshBalance }: WrapperDialogContentProps) {
  const { mutateAsync: writeContractAsync, isPending } = useWriteContract();
  const client = usePublicClient();
  const { address } = useConnection();

  const [inputAmount, setInputAmount] = useState("");
  const [status, setStatus] = useState<"none" | "signing" | "executing" | "success" | "error">("none");

  const wormholeAbis: Record<typeof implementationType, Abi> = {
    WETH: parseAbi([
      "function deposit() public payable",
      "function withdraw(uint256 amount) public",
    ]),
    ERC20: parseAbi([
      "function depositFor(address account, uint256 value) public returns (bool)",
      "function withdrawTo(address account, uint256 value) public returns (bool)",
    ]),
    ERC4626: erc4626Abi,
  };

  const { data: sharesPerAsset } = useReadContract({
    address: wormholeAsset.address,
    abi: erc4626Abi,
    functionName: "convertToShares",
    args: [BigInt(1e18)],
    query: {
      enabled: !!wormholeAsset.address && implementationType === "ERC4626",
    }
  });

  const isDeposit = transactionType === "deposit";

  const inputAsset = isDeposit
    ? { symbol: underlyingAsset.symbol, decimals: underlyingAsset.decimals, balance: underlyingAsset.balance }
    : { symbol: wormholeAsset.symbol, decimals: wormholeAsset.decimals, balance: wormholeAsset.balance };

  const outputAsset = isDeposit
    ? { symbol: wormholeAsset.symbol, decimals: wormholeAsset.decimals, balance: wormholeAsset.balance }
    : { symbol: underlyingAsset.symbol, decimals: underlyingAsset.decimals, balance: underlyingAsset.balance };

  const parsedAmount = useMemo(() => {
    return parseUnits(inputAmount, inputAsset.decimals);
  }, [inputAmount, inputAsset.decimals]);

  // Mock calculation - in real app this would come from a price feed
  const outputAmount = useMemo(() => {
    if (implementationType === "ERC4626") {
      return formatUnits((sharesPerAsset ?? 0n) * BigInt(inputAmount), outputAsset.decimals);
    } else {
      return inputAmount;
    }
  }, [inputAmount, sharesPerAsset]);

  const handleTransaction = useCallback(async () => {
    try {
      setStatus("signing");
      const depositParams = implementationType === "WETH" ? {
        address: wormholeAsset.address,
        abi: wormholeAbis[implementationType],
        value: parsedAmount,
        functionName: "deposit",
      } : implementationType === "ERC20" ? {
        address: wormholeAsset.address,
        abi: wormholeAbis[implementationType],
        functionName: "depositFor",
        args: [address!, parsedAmount],
      } : {
        address: wormholeAsset.address,
        abi: wormholeAbis[implementationType],
        functionName: "deposit",
        args: [parsedAmount, address!],
      };

      const withdrawParams = implementationType === "WETH" ? {
        address: wormholeAsset.address,
        abi: wormholeAbis[implementationType],
        functionName: "withdraw",
        args: [parsedAmount],
      } : implementationType === "ERC20" ? {
        address: wormholeAsset.address,
        abi: wormholeAbis[implementationType],
        functionName: "withdrawTo",
        args: [address!, parsedAmount],
      } : {
        address: wormholeAsset.address,
        abi: wormholeAbis[implementationType],
        functionName: "withdraw",
        args: [parsedAmount, address!],
      };

      const hash = isDeposit
        ? await writeContractAsync(depositParams)
        : await writeContractAsync(withdrawParams);

      setStatus("executing");
      toast.info(`Waiting for transaction to be confirmed...`);

      const receipt = await waitForTransactionReceipt(client!, { hash });
      if (receipt.status === "success") {
        setStatus("success");
        toast.success("Transaction confirmed!");
        refreshBalance();
      } else {
        setStatus("error");
        toast.error("Transaction failed.");
      }
    } catch (error) {
      setStatus("error");
      toast.error("Transaction failed.");
      console.error(error);
    }
    setStatus("none");
  }, [implementationType, isDeposit, writeContractAsync, wormholeAsset.address, parsedAmount, client]);

  return (
    <div className="flex flex-col gap-5">
      {/* Input amount field */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground">From</label>
        <InputGroup className="h-14 rounded-xl border-2 border-border bg-background focus-within:border-[#0d9488] transition-all">
          <InputGroupInput
            type="text"
            placeholder="0"
            value={inputAmount}
            onChange={(e) => {
              setInputAmount(e.target.value.replace(/[^0-9.]/g, ''));
            }}
            className="text-right text-xl font-bold focus:text-foreground"
          />
          <InputGroupAddon align="inline-end" className="pr-4 w-24 text-left justify-start">
            <span className="font-bold text-foreground text-base">{inputAsset.symbol}</span>
          </InputGroupAddon>
        </InputGroup>
        <div className="flex justify-between items-center px-2">
          <span className="text-xs text-muted-foreground">
            Balance: {formatBalance(inputAsset.balance, inputAsset.decimals)} {inputAsset.symbol}
          </span>
          <Button 
            variant="ghost" 
            size="xs" 
            onClick={() => {
              setInputAmount(formatUnits(inputAsset.balance, inputAsset.decimals));
            }}
            className="text-xs font-semibold text-[#0d9488] hover:text-[#0f766e]"
          >
            Max
          </Button>
        </div>
      </div>

      {/* Arrow */}
      <div className="flex justify-center -my-2 relative z-10">
        <div className="w-10 h-10 rounded-full bg-secondary border-2 border-border flex items-center justify-center">
          <ArrowDown className="w-5 h-5 text-[#0d9488]" />
        </div>
      </div>

      {/* Output amount display */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground">To (estimated)</label>
        <InputGroup className="h-14 rounded-xl border-2 border-border bg-secondary">
          <InputGroupInput
            type="text"
            placeholder="0"
            value={outputAmount}
            readOnly
            className="text-right text-xl font-bold text-foreground"
          />
          <InputGroupAddon align="inline-end" className="pr-4 w-24 text-left justify-start">
            <span className="font-bold text-foreground text-base">{outputAsset.symbol}</span>
          </InputGroupAddon>
        </InputGroup>
        <div className="flex justify-end px-2 text-xs text-muted-foreground">
          Balance: {formatBalance(outputAsset.balance, outputAsset.decimals)} {outputAsset.symbol}
        </div>
      </div>

      {/* Submit button */}
      <Button 
        className="w-full h-12 rounded-xl text-base mt-2" 
        onClick={handleTransaction} 
        disabled={status !== "none"}
      >
        {(status === "signing" || status === "executing") && <Loader2 className="size-4 animate-spin mr-2" />}
        {isDeposit ? "Deposit" : "Withdraw"}
      </Button>
    </div>
  );
}
