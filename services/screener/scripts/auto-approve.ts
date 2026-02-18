import { createWalletClient, getAddress, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { queryPendingWormholeEntries } from "../src/subgraph";
import { ALL_CHAIN_IDS, getChain } from "../src/configs";
import { PRIVATE_KEY, CONTRACT_ADDRESS } from "../src/env";
import ShieldedPoolAbi from "../../../contracts/out/ShieldedPool.sol/ShieldedPool.json";
import LeanIMTAbi from "../../../contracts/out/LeanIMT.sol/LeanIMT.json";

const account = privateKeyToAccount(PRIVATE_KEY);

async function approveOnChain(chainId: number) {
  const { label, chain, rpcUrl } = getChain(chainId);

  console.log(`\n[${ label }] Querying pending wormhole entries...`);

  const { wormholeEntries } = await queryPendingWormholeEntries(chainId);

  if (!wormholeEntries.length) {
    console.log(`[${label}] No pending entries, skipping.`);
    return;
  }

  console.log(`[${label}] Found ${wormholeEntries.length} pending entries`);

  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions);

  const approvals = wormholeEntries.map((entry) => ({
    entryId: entry.entryId,
    approved: true,
  }));

  console.log(`[${label}] Submitting ${approvals.length} approvals onchain...`);

  const hash = await client.writeContract({
    address: getAddress(CONTRACT_ADDRESS),
    abi: [...ShieldedPoolAbi.abi, ...LeanIMTAbi.abi],
    functionName: "appendManyWormholeLeaves",
    args: [approvals],
  });

  console.log(`[${label}] tx hash: ${hash}`);
  console.log(`[${label}] Waiting for confirmation...`);

  await client.waitForTransactionReceipt({ hash });

  console.log(`[${label}] Confirmed. ${approvals.length} entries approved.`);
}

async function main() {
  console.log(`Account: ${account.address}`);
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`Chains: ${ALL_CHAIN_IDS.map(id => getChain(id).label).join(", ")}`);

  for (const chainId of ALL_CHAIN_IDS) {
    try {
      await approveOnChain(chainId);
    } catch (err) {
      console.error(`[${getChain(chainId).label}] Failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("\nDone.");
}

main().catch(console.error).finally(() => process.exit(0));
