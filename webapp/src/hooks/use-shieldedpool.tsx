import { useQuery } from "@tanstack/react-query";
import { Address } from "viem";
import { ShieldedPool } from "../storage/shielded-pool";
import { useConnection } from "wagmi";
import { NoteDBWormholeEntry } from "../types";

export function useShieldedPool() {
  const { address } = useConnection();
  return useQuery({
    queryKey: ["shieldedPool", address],
    queryFn: () => {
      return address ? new ShieldedPool(address) : undefined;
    },
    enabled: !!address,
  });
}

export function useWormholeNotes(params?: {
  status?: NoteDBWormholeEntry["status"];
}) {
  const { data: shieldedPool } = useShieldedPool();
  return useQuery({
    queryKey: ["wormholeNotes", shieldedPool?.account],
    queryFn: async () => {
      if (!shieldedPool) return [];
      const notes = await shieldedPool.getWormholeNotes();
      if (params?.status) {
        return notes.filter((n) => n.status === params.status);
      }
      return notes;
    },
    enabled: !!shieldedPool,
  });
}

export function useShieldedBalance(args: { chainId: number, token: Address, tokenId?: bigint, excludeWormholes?: boolean }) {
  const { data: shieldedPool } = useShieldedPool();
  return useQuery({
    queryKey: ["shieldedBalance", shieldedPool?.account, args],
    queryFn: async () => {
      if (!shieldedPool) return 0n;
      return await shieldedPool.getShieldedBalance(args);
    },
    enabled: !!shieldedPool,
  });
}

export function useShieldedBalances(args: { chainId: number, tokens: Address[] | { token: Address, tokenId?: bigint }[], excludeWormholes?: boolean }) {
  const { data: shieldedPool } = useShieldedPool();
  return useQuery({
    queryKey: ["shieldedBalances", shieldedPool?.account, args],
    queryFn: async () => {
      if (!shieldedPool) return [];
      return await Promise.all(args.tokens.map(token => {
        if (typeof token === "string") {
          return shieldedPool.getShieldedBalance({ chainId: args.chainId, token, excludeWormholes: args.excludeWormholes });
        }
        return shieldedPool.getShieldedBalance({ chainId: args.chainId, token: token.token, tokenId: token.tokenId, excludeWormholes: args.excludeWormholes });
      }));
    },
    enabled: !!shieldedPool,
  });
}