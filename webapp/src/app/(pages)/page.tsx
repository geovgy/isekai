import { AssetsTable } from "@/src/components/asset-table";
import { CreateAssetDialog } from "@/src/components/create-asset-dialog";
import { Button } from "@/src/components/ui/button";
import { PlusIcon, Sparkles, Shield } from "lucide-react";

export default function Home() {
  return (
    <div className="w-full max-w-7xl mx-auto py-12 px-6">
      {/* Table Section */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-border/50 flex justify-between">
          <div>
            <h2 className="text-lg font-semibold">Available Assets</h2>
            <p className="text-sm text-muted-foreground">Assets that support zk-wormholes and shielded transfers.</p>
          </div>
          {/* <CreateAssetDialog
            trigger={
              <Button 
                className="px-6"
              >
                <PlusIcon className="w-5 h-5 mr-2" />
                Create Asset
              </Button>
            }
          /> */}
        </div>
        <AssetsTable />
      </div>
    </div>
  );
}
