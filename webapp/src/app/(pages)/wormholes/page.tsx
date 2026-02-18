import { WormholesTable } from "@/src/components/wormhole-table";
import { SyncMasterTree } from "@/src/components/sync-master-tree";

export default function WormholesPage() {
  return (
    <div className="w-full max-w-7xl mx-auto py-12 px-6 space-y-6">
      {/* Table Section */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-border/50 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">My Wormhole Transfers</h2>
            <p className="text-sm text-muted-foreground">View and track the status of your wormhole transfers</p>
          </div>
          <SyncMasterTree />
        </div>
        <WormholesTable />
      </div>
    </div>
  );
}
