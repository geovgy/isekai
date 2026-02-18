import { queryPendingWormholeEntries } from "./subgraph";
import { ALL_CHAIN_IDS, getChain } from "./configs";

// TODO: Implement the screener
for (const chainId of ALL_CHAIN_IDS) {
  console.log(`\n--- ${getChain(chainId).label} ---`);
  queryPendingWormholeEntries(chainId).then(console.log);
}
