"use client";

import { formatAddress } from "@/src/components/address";
import { useShieldedPool } from "@/src/hooks/use-shieldedpool";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/components/ui/tabs";
import { Textarea } from "@/src/components/ui/textarea";
import { getChainConfig, SUPPORTED_CHAINS, SUPPORTED_CHAIN_IDS } from "@/src/config";
import { WORMHOLE_TOKENS } from "@/src/env";
import { cn, formatBalance } from "@/src/lib/utils";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import { erc20Abi, getAddress, isAddress, isAddressEqual, parseUnits } from "viem";
import {
  useChainId,
  useConfig as useWagmiConfig,
  useConnection,
  useReadContracts,
} from "wagmi";
import { signTypedData } from "wagmi/actions";

interface MarketOfferItem {
  srcChainId?: string | null;
  dstChainId: string;
  token: string;
  tokenId: string;
  amount: string;
}

interface MarketOffer {
  ask: MarketOfferItem;
  for: MarketOfferItem;
  status?: string | null;
}

interface MarketSignerDelegation {
  chainId: string;
  owner: Address;
  delegate: Address;
  startTime: string;
  endTime: string;
  token: Address;
  tokenId: string;
  amount: string;
  amountType: number;
  maxCumulativeAmount: string;
  maxNonce: string;
  timeInterval: string;
  transferType: number;
}

interface MarketOfferRow {
  id: string;
  makerAddress: Address | null;
  offer: MarketOffer;
  offerStatus: "open" | "fulfilled" | "cancelled" | string;
  signerDelegation: MarketSignerDelegation | null;
  signature: string | null;
  shieldedMasterRoot: string | null;
  inputNotes: unknown[] | null;
  outputNotes: unknown[] | null;
  wormholeNote: unknown | null;
  createdAt: string;
  updatedAt: string;
}

interface MarketOffersResponse {
  filters: string[];
  orders: MarketOfferRow[];
}

interface TokenMetadata {
  address: Address;
  symbol: string;
  decimals: number;
}

const signerDelegationTypes = {
  SignerDelegation: [
    { name: "chainId", type: "uint64" },
    { name: "owner", type: "address" },
    { name: "delegate", type: "address" },
    { name: "startTime", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "token", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "amountType", type: "uint8" },
    { name: "maxCumulativeAmount", type: "uint64" },
    { name: "maxNonce", type: "uint64" },
    { name: "timeInterval", type: "uint64" },
    { name: "transferType", type: "uint8" },
  ],
} as const;

const tokenOptions = WORMHOLE_TOKENS.map(token => getAddress(token));
const fallbackToken = tokenOptions[0] ?? getAddress("0x0000000000000000000000000000000000000000");

function statusBadgeClass(status: string) {
  switch (status) {
    case "open":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "fulfilled":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
    case "cancelled":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getOrderMakerAddress(order: MarketOfferRow) {
  return order.makerAddress ?? order.signerDelegation?.owner ?? null;
}

function parseOptionalJson(input: string, fieldName: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${fieldName}`);
  }
}

function parseOptionalJsonArray(input: string, fieldName: string) {
  const parsed = parseOptionalJson(input, fieldName);
  if (parsed === null) {
    return null;
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }
  return parsed;
}

function useTokenMetadata(chainId: number) {
  const contracts = useMemo(
    () =>
      tokenOptions.flatMap(token => [
        {
          address: token,
          abi: erc20Abi,
          functionName: "symbol" as const,
          chainId,
        },
        {
          address: token,
          abi: erc20Abi,
          functionName: "decimals" as const,
          chainId,
        },
      ]),
    [chainId],
  );

  const { data } = useReadContracts({
    allowFailure: true,
    contracts,
    query: {
      enabled: tokenOptions.length > 0,
      select: results =>
        tokenOptions.map((address, index) => {
          const offset = index * 2;
          return {
            address,
            symbol: (results[offset]?.result as string | undefined) ?? formatAddress(address),
            decimals: Number((results[offset + 1]?.result as number | bigint | undefined) ?? 18),
          } satisfies TokenMetadata;
        }),
    },
  });

  return (
    data ??
    tokenOptions.map(address => ({
      address,
      symbol: formatAddress(address),
      decimals: 18,
    }))
  );
}

function formatTokenOption(address: Address, metadata: TokenMetadata[]) {
  const token = metadata.find(option => option.address === address);
  return token ? `${token.symbol} (${formatAddress(address)})` : formatAddress(address);
}

function formatMarketItem(item: MarketOfferItem, metadata: TokenMetadata[]) {
  const chainLabel = SUPPORTED_CHAINS[Number(item.dstChainId)]?.label ?? `Chain ${item.dstChainId}`;
  const sourceChainLabel =
    item.srcChainId && SUPPORTED_CHAINS[Number(item.srcChainId)]
      ? SUPPORTED_CHAINS[Number(item.srcChainId)].label
      : null;

  return {
    title: `${item.amount} @ ${chainLabel}`,
    token: isAddress(item.token)
      ? formatTokenOption(getAddress(item.token), metadata)
      : item.token,
    tokenId: item.tokenId,
    sourceChainLabel,
  };
}

function parseMarketAmountToUnits(value: string, decimals: number) {
  return parseUnits(value.trim(), decimals);
}

function requireValidAddress(value: string | null | undefined, label: string): Address {
  if (!value || !isAddress(value)) {
    throw new Error(`${label} is not configured`);
  }
  return getAddress(value);
}

function CreateOfferDialog({
  open,
  onOpenChange,
  connectedAddress,
  relayerAddress,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectedAddress?: Address;
  relayerAddress?: Address | null;
  onSubmitted: () => Promise<void>;
}) {
  const wagmiConfig = useWagmiConfig();
  const { data: shieldedPool } = useShieldedPool();
  const walletChainId = useChainId();
  const defaultChainId = SUPPORTED_CHAIN_IDS[0] ?? walletChainId;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [askToken, setAskToken] = useState<Address>(fallbackToken);
  const [askAmount, setAskAmount] = useState("");
  const [askDstChainId, setAskDstChainId] = useState(String(defaultChainId));
  const [forToken, setForToken] = useState<Address>(fallbackToken);
  const [forAmount, setForAmount] = useState("");
  const [forDstChainId, setForDstChainId] = useState(String(defaultChainId));
  const [forSourceChainId, setForSourceChainId] = useState(String(defaultChainId));

  useEffect(() => {
    if (!open) {
      return;
    }
    const initialChainId = String(defaultChainId);
    setAskToken(fallbackToken);
    setAskAmount("");
    setAskDstChainId(initialChainId);
    setForToken(fallbackToken);
    setForAmount("");
    setForDstChainId(initialChainId);
    setForSourceChainId(initialChainId);
  }, [defaultChainId, open]);

  const askTokenMetadata = useTokenMetadata(Number(askDstChainId || defaultChainId));
  const forTokenMetadata = useTokenMetadata(Number(forSourceChainId || defaultChainId));

  const privateBalanceQueries = useQueries({
    queries: SUPPORTED_CHAIN_IDS.map(chainId => ({
      queryKey: ["marketPrivateBalance", shieldedPool?.account, chainId, forToken],
      queryFn: async () => {
        if (!shieldedPool) {
          return 0n;
        }
        return shieldedPool.getShieldedBalance({
          chainId,
          token: forToken,
          excludeWormholes: false,
        });
      },
      enabled: !!shieldedPool,
    })),
  });

  const privateBalancesByChain = useMemo(
    () =>
      Object.fromEntries(
        SUPPORTED_CHAIN_IDS.map((chainId, index) => [
          chainId,
          privateBalanceQueries[index]?.data ?? 0n,
        ]),
      ),
    [privateBalanceQueries],
  );

  const selectedForTokenMetadata = useMemo(
    () => forTokenMetadata.find(token => token.address === forToken),
    [forToken, forTokenMetadata],
  );

  async function handleCreate() {
    if (!connectedAddress) {
      toast.error("Connect your wallet to create a market offer");
      return;
    }
    if (!askAmount.trim() || !forAmount.trim()) {
      toast.error("Enter both ask and for amounts");
      return;
    }
    if (!shieldedPool) {
      toast.error("Shielded pool not available");
      return;
    }
    if (!relayerAddress || !isAddress(relayerAddress)) {
      toast.error("Relayer address not configured");
      return;
    }

    setIsSubmitting(true);
    try {
      const forAmountUnits = parseMarketAmountToUnits(forAmount, selectedForTokenMetadata?.decimals ?? 18);
      const delegateAddress = requireValidAddress(relayerAddress, "Relayer address");
      const offer = {
        ask: {
          dstChainId: askDstChainId,
          token: askToken,
          tokenId: "0",
          amount: askAmount.trim(),
        },
        for: {
          srcChainId: forSourceChainId,
          dstChainId: forDstChainId,
          token: forToken,
          tokenId: "0",
          amount: forAmount.trim(),
        },
      } satisfies MarketOffer;

      const notes = await shieldedPool.prepareMarketOfferNotes({
        srcChainId: Number(forSourceChainId),
        token: forToken,
        tokenId: 0n,
        amount: forAmountUnits,
      });

      const now = Math.floor(Date.now() / 1000);
      const delegationPreview = {
        chainId: forSourceChainId,
        owner: connectedAddress,
        delegate: delegateAddress,
        startTime: String(now),
        endTime: String(now + 60 * 60),
        token: requireValidAddress(forToken, "For token address"),
        tokenId: "0",
        amount: forAmountUnits.toString(),
        amountType: 0,
        maxCumulativeAmount: forAmountUnits.toString(),
        maxNonce: "1",
        timeInterval: "0",
        transferType: 0,
      } satisfies MarketSignerDelegation;
      const chainConfig = getChainConfig(Number(forSourceChainId));
      const verifyingContract = requireValidAddress(
        chainConfig.branchContractAddress,
        `${chainConfig.label} branch contract address`,
      );
      const signature = await signTypedData(wagmiConfig, {
        account: connectedAddress,
        domain: {
          name: "ShieldedPool",
          version: "1",
          chainId: BigInt(forSourceChainId),
          verifyingContract,
        },
        primaryType: "SignerDelegation",
        types: signerDelegationTypes,
        message: {
          ...delegationPreview,
          chainId: BigInt(delegationPreview.chainId),
          startTime: BigInt(delegationPreview.startTime),
          endTime: BigInt(delegationPreview.endTime),
          tokenId: BigInt(delegationPreview.tokenId),
          amount: BigInt(delegationPreview.amount),
          maxCumulativeAmount: BigInt(delegationPreview.maxCumulativeAmount),
          maxNonce: BigInt(delegationPreview.maxNonce),
          timeInterval: BigInt(delegationPreview.timeInterval),
        },
      });

      const response = await fetch("/api/market/offer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          makerAddress: connectedAddress,
          offer,
          signerDelegation: delegationPreview,
          signature,
          notes,
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? "Failed to create market offer");
      }

      toast.success("Market offer created");
      onOpenChange(false);
      await onSubmitted();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to create market offer");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Market Offer</DialogTitle>
          <DialogDescription>
            Define what you are asking for and what you are offering in return.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border-2 border-border bg-muted/30 p-4">
            <div className="text-sm font-medium">Ask</div>
            <div>
              <label className="mb-1 block text-sm font-medium">Token</label>
              <Select value={askToken} onValueChange={value => setAskToken(getAddress(value))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select token" />
                </SelectTrigger>
                <SelectContent>
                  {tokenOptions.map(token => (
                    <SelectItem key={token} value={token}>
                      {formatTokenOption(token, askTokenMetadata)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Amount</label>
              <Input
                value={askAmount}
                onChange={event => setAskAmount(event.target.value)}
                placeholder="Amount"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Receive On Chain</label>
              <Select value={askDstChainId} onValueChange={setAskDstChainId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select chain" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CHAIN_IDS.map(chainId => (
                    <SelectItem key={chainId} value={String(chainId)}>
                      {SUPPORTED_CHAINS[chainId].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border-2 border-border bg-muted/30 p-4">
            <div className="text-sm font-medium">For</div>
            <div>
              <label className="mb-1 block text-sm font-medium">Source Chain</label>
              <Select value={forSourceChainId} onValueChange={setForSourceChainId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source chain" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_CHAIN_IDS.map(chainId => (
                    <SelectItem key={chainId} value={String(chainId)}>
                      {SUPPORTED_CHAINS[chainId].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Token</label>
              <Select value={forToken} onValueChange={value => setForToken(getAddress(value))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select token" />
                </SelectTrigger>
                <SelectContent>
                  {tokenOptions.map(token => (
                    <SelectItem key={token} value={token}>
                      {formatTokenOption(token, forTokenMetadata)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Amount</label>
              <Input
                value={forAmount}
                onChange={event => setForAmount(event.target.value)}
                placeholder="Amount"
              />
            </div>

            <div className="rounded-lg bg-background p-3 text-sm">
              <div className="font-medium text-foreground">Available Private Balance Per Chain</div>
              <div className="mt-2 space-y-1 text-muted-foreground">
                {SUPPORTED_CHAIN_IDS.map(chainId => (
                  <div key={chainId} className="flex items-center justify-between">
                    <span>{SUPPORTED_CHAINS[chainId].label}</span>
                    <span className={cn(chainId === Number(forSourceChainId) ? "font-medium text-foreground" : "")}>
                      {formatBalance(
                        privateBalancesByChain[chainId] ?? 0n,
                        selectedForTokenMetadata?.decimals ?? 18,
                      )}{" "}
                      {selectedForTokenMetadata?.symbol ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!connectedAddress || isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FulfillOrderDialog({
  open,
  onOpenChange,
  order,
  connectedAddress,
  relayerAddress,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: MarketOfferRow | null;
  connectedAddress?: Address;
  relayerAddress?: Address | null;
  onSubmitted: () => Promise<void>;
}) {
  const wagmiConfig = useWagmiConfig();
  const walletChainId = useChainId();
  const metadata = useTokenMetadata(walletChainId || SUPPORTED_CHAIN_IDS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputNotesJson, setInputNotesJson] = useState("");
  const [outputNotesJson, setOutputNotesJson] = useState("");
  const [wormholeNoteJson, setWormholeNoteJson] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    setInputNotesJson("");
    setOutputNotesJson("");
    setWormholeNoteJson("");
  }, [open, order?.id]);

  const delegationPreview = useMemo(() => {
    if (!order || !connectedAddress || !relayerAddress || !isAddress(relayerAddress)) {
      return null;
    }

    const askChainId = Number(order.offer.ask.dstChainId);
    const askToken = isAddress(order.offer.ask.token) ? getAddress(order.offer.ask.token) : null;
    if (!askToken) {
      return null;
    }
    const askTokenInfo = metadata.find(token => token.address === askToken);

    try {
      const askAmountUnits = parseMarketAmountToUnits(order.offer.ask.amount, askTokenInfo?.decimals ?? 18);
      const now = Math.floor(Date.now() / 1000);
      return {
        chainId: String(askChainId),
        owner: connectedAddress,
        delegate: getAddress(relayerAddress),
        startTime: String(now),
        endTime: String(now + 60 * 60),
        token: askToken,
        tokenId: order.offer.ask.tokenId,
        amount: askAmountUnits.toString(),
        amountType: 0,
        maxCumulativeAmount: askAmountUnits.toString(),
        maxNonce: "1",
        timeInterval: "0",
        transferType: 0,
      } satisfies MarketSignerDelegation;
    } catch {
      return null;
    }
  }, [connectedAddress, metadata, order, relayerAddress]);

  async function handleConfirm() {
    if (!order) {
      return;
    }
    if (!connectedAddress) {
      toast.error("Connect your wallet to fulfill an order");
      return;
    }
    if (!delegationPreview) {
      toast.error("Unable to build signer delegation for this order");
      return;
    }

    setIsSubmitting(true);
    try {
      const askChainId = Number(order.offer.ask.dstChainId);
      const chainConfig = getChainConfig(askChainId);
      const verifyingContract = requireValidAddress(
        chainConfig.branchContractAddress,
        `${chainConfig.label} branch contract address`,
      );
      const signature = await signTypedData(wagmiConfig, {
        account: connectedAddress,
        domain: {
          name: "ShieldedPool",
          version: "1",
          chainId: BigInt(askChainId),
          verifyingContract,
        },
        primaryType: "SignerDelegation",
        types: signerDelegationTypes,
        message: {
          ...delegationPreview,
          chainId: BigInt(delegationPreview.chainId),
          startTime: BigInt(delegationPreview.startTime),
          endTime: BigInt(delegationPreview.endTime),
          tokenId: BigInt(delegationPreview.tokenId),
          amount: BigInt(delegationPreview.amount),
          maxCumulativeAmount: BigInt(delegationPreview.maxCumulativeAmount),
          maxNonce: BigInt(delegationPreview.maxNonce),
          timeInterval: BigInt(delegationPreview.timeInterval),
        },
      });

      const inputNotes = parseOptionalJsonArray(inputNotesJson, "input notes");
      const outputNotes = parseOptionalJsonArray(outputNotesJson, "output notes");
      const wormholeNote = parseOptionalJson(wormholeNoteJson, "wormhole note");

      const response = await fetch("/api/market/fulfill-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          marketOfferId: order.id,
          signerDelegation: delegationPreview,
          signature,
          notes: {
            inputNotes,
            outputNotes,
            wormholeNote,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? "Failed to submit fulfill order request");
      }

      toast.success("Fulfill order request submitted");
      onOpenChange(false);
      await onSubmitted();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Failed to fulfill order");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fulfill Market Order</DialogTitle>
          <DialogDescription>
            Confirm the delegation signature, then submit the notes to use for fulfilling this order.
          </DialogDescription>
        </DialogHeader>

        {order && delegationPreview ? (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-border bg-muted/30 p-4">
              <div className="text-sm font-medium">Order Summary</div>
              <div className="mt-2 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <div>
                  <div className="font-medium text-foreground">Ask</div>
                  <div>{formatMarketItem(order.offer.ask, metadata).title}</div>
                  <div>{formatMarketItem(order.offer.ask, metadata).token}</div>
                  <div>Token ID: {order.offer.ask.tokenId}</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">For</div>
                  <div>{formatMarketItem(order.offer.for, metadata).title}</div>
                  <div>{formatMarketItem(order.offer.for, metadata).token}</div>
                  {formatMarketItem(order.offer.for, metadata).sourceChainLabel ? (
                    <div>Source: {formatMarketItem(order.offer.for, metadata).sourceChainLabel}</div>
                  ) : null}
                  <div>Token ID: {order.offer.for.tokenId}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border-2 border-border bg-muted/30 p-4">
              <div className="text-sm font-medium">Delegation To Sign</div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-xs text-muted-foreground">
                {JSON.stringify(delegationPreview, null, 2)}
              </pre>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Input Notes JSON</label>
                <Textarea
                  value={inputNotesJson}
                  onChange={event => setInputNotesJson(event.target.value)}
                  placeholder='[{"chain_id":"...","amount":"..."}]'
                  className="min-h-28"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Output Notes JSON</label>
                <Textarea
                  value={outputNotesJson}
                  onChange={event => setOutputNotesJson(event.target.value)}
                  placeholder='[{"chain_id":"...","amount":"..."}]'
                  className="min-h-28"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Wormhole Note JSON</label>
                <Textarea
                  value={wormholeNoteJson}
                  onChange={event => setWormholeNoteJson(event.target.value)}
                  placeholder='{"src_chain_id":"...","entry_id":"..."}'
                  className="min-h-24"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-border p-6 text-sm text-muted-foreground">
            Connect a wallet and select a valid order to prepare fulfillment.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!order || !connectedAddress || isSubmitting}>
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrdersTable({
  orders,
  metadata,
  action,
  emptyMessage,
}: {
  orders: MarketOfferRow[];
  metadata: TokenMetadata[];
  action?: (order: MarketOfferRow) => React.ReactNode;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-2xl border-2 border-border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Ask</TableHead>
            <TableHead>For</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            orders.map(order => {
              const ask = formatMarketItem(order.offer.ask, metadata);
              const requested = formatMarketItem(order.offer.for, metadata);

              return (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.id}</TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{ask.title}</div>
                    <div className="text-xs text-muted-foreground">{ask.token}</div>
                    <div className="text-xs text-muted-foreground">Token ID: {order.offer.ask.tokenId}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{requested.title}</div>
                    <div className="text-xs text-muted-foreground">{requested.token}</div>
                    {requested.sourceChainLabel ? (
                      <div className="text-xs text-muted-foreground">
                        Source: {requested.sourceChainLabel}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">Token ID: {order.offer.for.tokenId}</div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                        statusBadgeClass(order.offerStatus),
                      )}
                    >
                      {order.offerStatus}
                    </span>
                  </TableCell>
                  <TableCell>{new Date(order.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {action ? action(order) : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function MarketPage() {
  const { address } = useConnection();
  const walletChainId = useChainId();
  const metadata = useTokenMetadata(walletChainId || SUPPORTED_CHAIN_IDS[0]);
  const [activeTab, setActiveTab] = useState("open");
  const [selectedOrder, setSelectedOrder] = useState<MarketOfferRow | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: offersResponse, isLoading, error, refetch } = useQuery({
    queryKey: ["marketOffers"],
    queryFn: async () => {
      const response = await fetch("/api/market/offers");
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to load market offers");
      }
      return (await response.json()) as MarketOffersResponse;
    },
  });
  const { data: delegateAddressResponse } = useQuery({
    queryKey: ["delegateAddress"],
    queryFn: async () => {
      const response = await fetch("/api/delegate-address");
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to load delegate address");
      }
      return (await response.json()) as { address: Address };
    },
  });

  const allOrders = offersResponse?.orders ?? [];
  const relayerAddress = delegateAddressResponse?.address ?? null;
  const openOrders = useMemo(
    () => allOrders.filter(order => order.offerStatus === "open"),
    [allOrders],
  );
  const myOrders = useMemo(() => {
    if (!address) {
      return [];
    }

    return allOrders.filter(order => {
      const maker = getOrderMakerAddress(order);
      return maker ? isAddressEqual(maker, address) : false;
    });
  }, [address, allOrders]);

  const openOrdersForFulfillment = useMemo(() => {
    if (!address) {
      return openOrders;
    }

    return openOrders.filter(order => {
      const maker = getOrderMakerAddress(order);
      return maker ? !isAddressEqual(maker, address) : true;
    });
  }, [address, openOrders]);

  return (
    <div className="w-full max-w-7xl mx-auto py-12 px-6">
      <div className="glass rounded-2xl overflow-hidden">
        <div className="border-b border-border/50 p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Market Offers</h2>
            <p className="text-sm text-muted-foreground">
              Browse open offers and review every order you have created.
            </p>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} disabled={!address}>
            <Plus className="size-4" />
            New Market Offer
          </Button>
        </div>

        <div className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full max-w-md rounded-xl bg-secondary border-2 border-border">
              <TabsTrigger
                value="open"
                className="rounded-lg data-[state=active]:bg-[#0d9488] data-[state=active]:text-white"
              >
                Open Offers
              </TabsTrigger>
              <TabsTrigger
                value="mine"
                className="rounded-lg data-[state=active]:bg-[#0d9488] data-[state=active]:text-white"
              >
                My Orders
              </TabsTrigger>
            </TabsList>

            <TabsContent value="open" className="mt-6">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading market offers...
                </div>
              ) : error ? (
                <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {(error as Error).message}
                </div>
              ) : (
                <OrdersTable
                  orders={openOrdersForFulfillment}
                  metadata={metadata}
                  emptyMessage="No open market offers available."
                  action={order => (
                    <Button
                      size="sm"
                      onClick={() => setSelectedOrder(order)}
                      disabled={!address}
                    >
                      Fulfill Order
                    </Button>
                  )}
                />
              )}
            </TabsContent>

            <TabsContent value="mine" className="mt-6">
              {!address ? (
                <div className="rounded-xl border-2 border-dashed border-border p-6 text-sm text-muted-foreground">
                  Connect your wallet to view your market orders.
                </div>
              ) : isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Loading your market orders...
                </div>
              ) : error ? (
                <div className="rounded-xl border-2 border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  {(error as Error).message}
                </div>
              ) : (
                <OrdersTable
                  orders={myOrders}
                  metadata={metadata}
                  emptyMessage="You have not created any market orders yet."
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <CreateOfferDialog
        open={isCreateDialogOpen}
        connectedAddress={address}
        relayerAddress={relayerAddress}
        onOpenChange={setIsCreateDialogOpen}
        onSubmitted={async () => {
          await refetch();
          setActiveTab("mine");
        }}
      />

      <FulfillOrderDialog
        open={!!selectedOrder}
        order={selectedOrder}
        connectedAddress={address}
        relayerAddress={relayerAddress}
        onOpenChange={open => {
          if (!open) {
            setSelectedOrder(null);
          }
        }}
        onSubmitted={async () => {
          await refetch();
        }}
      />
    </div>
  );
}
