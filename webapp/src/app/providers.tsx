'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { ConnectKitProvider } from 'connectkit'
import { wagmiConfig } from '@/src/config'
import { ZKProverProvider } from "@/src/context/zk-prover";
import { TooltipProvider } from '../components/ui/tooltip'
import { useMasterTreeInclusionSync } from '@/src/hooks/use-subgraph'

const queryClient = new QueryClient()

function MasterTreeSync() {
  useMasterTreeInclusionSync();
  return null;
}

export function Providers({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider>
          <ZKProverProvider>
            <TooltipProvider>
              <MasterTreeSync />
              {children}
            </TooltipProvider>
          </ZKProverProvider>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}