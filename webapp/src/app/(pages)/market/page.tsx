"use client";

import { formatAddress } from "@/src/components/address";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
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
import { getChainConfig, SUPPORTED_CHAINS } from "@/src/config";
import { cn } from "@/src/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import { getAddress, isAddress, isAddressEqual } from "viem";
import { useChainId, useConfig as useWagmiConfig, useConnection } from "wagmi";
import { signTypedData } from "wagmi/actions";

interface MarketOfferItem {
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

function formatMarketItem(item: MarketOfferItem) {
  const chainLabel = SUPPORTED_CHAINS[Number(item.dstChainId)]?.label ?? `Chain ${item.dstChainId}`;
  return {
    title: `${item.amount} @ ${chainLabel}`,
    token: isAddress(item.token) ? formatAddress(getAddress(item.token)) : item.token,
    tokenId: item.tokenId,
  };
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

function FulfillOrderDialog({
  open,
  onOpenChange,
  order,
  connectedAddress,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: MarketOfferRow | null;
  connectedAddress?: Address;
  onSubmitted: () => Promise<void>;
}) {
  const wagmiConfig = useWagmiConfig();
  const walletChainId = useChainId();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inputNotesJson, setInputNotesJson] = useState("");
  const [outputNotesJson, setOutputNotesJson] = useState("");
  const [wormholeNoteJson, setWormholeNoteJson] = useState("");

  useEffect(() => {
    if (open) {
      setInputNotesJson("");
      setOutputNotesJson("");
      setWormholeNoteJson("");
    }
  }, [open, order?.id]);

  const delegationPreview = useMemo(() => {
    if (!order || !connectedAddress) {
      return null;
    }

    const askChainId = Number(order.offer.ask.dstChainId);
    const delegate = getOrderMakerAddress(order);
    if (!delegate || !isAddress(delegate)) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    return {
      chainId: String(askChainId),
      owner: connectedAddress,
      delegate: getAddress(delegate),
      startTime: String(now),
      endTime: String(now + 60 * 60),
      token: getAddress(order.offer.ask.token),
      tokenId: order.offer.ask.tokenId,
      amount: order.offer.ask.amount,
      amountType: 0,
      maxCumulativeAmount: order.offer.ask.amount,
      maxNonce: "1",
      timeInterval: "0",
      transferType: 0,
    } satisfies MarketSignerDelegation;
  }, [connectedAddress, order]);

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
      const signature = await signTypedData(wagmiConfig, {
        account: connectedAddress,
        domain: {
          name: "ShieldedPool",
          version: "1",
          chainId: BigInt(askChainId),
          verifyingContract: getAddress(chainConfig.branchContractAddress),
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
          inputNotes,
          outputNotes,
          wormholeNote,
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
                  <div>{formatMarketItem(order.offer.ask).title}</div>
                  <div>{formatMarketItem(order.offer.ask).token}</div>
                  <div>Token ID: {order.offer.ask.tokenId}</div>
                </div>
                <div>
                  <div className="font-medium text-foreground">For</div>
                  <div>{formatMarketItem(order.offer.for).title}</div>
                  <div>{formatMarketItem(order.offer.for).token}</div>
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
  action,
  emptyMessage,
}: {
  orders: MarketOfferRow[];
  action?: (order: MarketOfferRow) => React.ReactNode;
  emptyMessage: string;
}) {
  return (
    <div className="rounded-2xl border-2 border-border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Maker</TableHead>
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
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            orders.map(order => {
              const ask = formatMarketItem(order.offer.ask);
              const requested = formatMarketItem(order.offer.for);

              return (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.id}</TableCell>
                  <TableCell>
                    {getOrderMakerAddress(order)
                      ? formatAddress(getOrderMakerAddress(order)!)
                      : "-"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{ask.title}</div>
                    <div className="text-xs text-muted-foreground">{ask.token}</div>
                    <div className="text-xs text-muted-foreground">Token ID: {order.offer.ask.tokenId}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{requested.title}</div>
                    <div className="text-xs text-muted-foreground">{requested.token}</div>
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
  const [activeTab, setActiveTab] = useState("open");
  const [selectedOrder, setSelectedOrder] = useState<MarketOfferRow | null>(null);

  const {
    data: offersResponse,
    isLoading,
    error,
    refetch,
  } = useQuery({
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

  const allOrders = offersResponse?.orders ?? [];
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
        <div className="border-b border-border/50 p-6">
          <h2 className="text-lg font-semibold">Market Offers</h2>
          <p className="text-sm text-muted-foreground">
            Browse open offers and review every order you have created.
          </p>
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
                  emptyMessage="You have not created any market orders yet."
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <FulfillOrderDialog
        open={!!selectedOrder}
        order={selectedOrder}
        connectedAddress={address}
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
