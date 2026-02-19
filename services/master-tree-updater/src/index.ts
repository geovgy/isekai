import { parseEventLogs, type Hex, type TransactionReceipt } from "viem"
import { CONTRACT_ADDRESS } from "./env"
import { MASTER_CHAIN_ID, BRANCH_CHAIN_IDS, getChain } from "./config"
// import { updateMasterTreesAbi, masterTreesUpdatedEventAbi } from "./abis"
import { abi as ShieldedPoolAbi } from "../../../contracts/out/ShieldedPool.sol/ShieldedPool.json"
import { account, getPublicClient, getWalletClient } from "./clients"
import { queryLatestBranchTreesUpdated } from "./subgraph"
import { getPolymerProofHex } from "./polymer"

async function sendUpdateMasterTrees(targetChainId: number, proof: Hex): Promise<TransactionReceipt> {
  const wallet = getWalletClient(targetChainId)
  const publicClient = getPublicClient(targetChainId)

  const hash = await wallet.writeContract({
    address: CONTRACT_ADDRESS,
    abi: ShieldedPoolAbi,
    functionName: "updateMasterTrees",
    args: [proof],
  })
  console.log(`  tx hash: ${hash}`)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted on chain ${targetChainId}: ${hash}`)
  }
  return receipt
}


async function main() {
  console.log(`Account: ${account.address}`)
  console.log(`Contract: ${CONTRACT_ADDRESS}`)
  console.log(`Master chain: ${getChain(MASTER_CHAIN_ID).label} (${MASTER_CHAIN_ID})`)
  console.log(`Branch chains: ${BRANCH_CHAIN_IDS.map(id => `${getChain(id).label} (${id})`).join(", ")}`)

  // Push branch roots --> master chain
  console.log("\n=== Step 1: Sync branch roots to master chain ===\n")

  let lastMasterReceipt: TransactionReceipt | undefined

  const masterPublicClient = getPublicClient(MASTER_CHAIN_ID)

  for (const branchChainId of BRANCH_CHAIN_IDS) {
    const label = getChain(branchChainId).label
    console.log(`[${label}] Querying latest BranchTreesUpdated event...`)

    const event = await queryLatestBranchTreesUpdated(branchChainId)
    if (!event) {
      console.log(`[${label}] No BranchTreesUpdated events found, skipping.\n`)
      continue
    }

    console.log(`[${label}] Found at block ${event.branchBlockNumber}, logIndex ${event.logIndex}`)

    const lastSyncedBlock = await masterPublicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: ShieldedPoolAbi,
      functionName: "lastBlockNumber",
      args: [BigInt(branchChainId)],
    }) as bigint

    if (BigInt(event.branchBlockNumber) <= lastSyncedBlock) {
      console.log(`[${label}] Already synced (master last block: ${lastSyncedBlock}), skipping.\n`)
      continue
    }

    console.log(`[${label}] Requesting Polymer proof...`)

    const proof = await getPolymerProofHex({
      sourceChainId: branchChainId,
      blockNumber: Number(event.branchBlockNumber),
      logIndex: Number(event.logIndex),
    })

    console.log(`[${label}] Polymer proof received (${proof.length} hex chars)`)
    console.log(`[${label}] Submitting updateMasterTrees on ${getChain(MASTER_CHAIN_ID).label}...`)

    const receipt = await sendUpdateMasterTrees(MASTER_CHAIN_ID, proof)
    lastMasterReceipt = receipt

    console.log(`[${label}] Master tree updated in block ${receipt.blockNumber}\n`)
  }

  if (!lastMasterReceipt) {
    console.log("No branch roots were synced. Nothing to propagate back.\n")
    return
  }

  // Push master root --> branch chains
  console.log("\n=== Step 2: Sync master root to branch chains ===\n")

  const masterUpdatedLogs = parseEventLogs({
    abi: ShieldedPoolAbi,
    eventName: "MasterTreesUpdated",
    logs: lastMasterReceipt.logs,
  })

  if (masterUpdatedLogs.length === 0) {
    console.error("ERROR: No MasterTreesUpdated event found in receipt. Aborting step 2.")
    return
  }

  const masterLog = masterUpdatedLogs[masterUpdatedLogs.length - 1]
  if (!masterLog || masterLog.logIndex == null) {
    console.error("ERROR: Could not extract MasterTreesUpdated log. Aborting step 2.")
    return
  }
  const masterBlockNumber = Number(lastMasterReceipt.blockNumber)
  const masterLogIndex = masterLog.logIndex

  console.log(`MasterTreesUpdated event at block ${masterBlockNumber}, logIndex ${masterLogIndex}`)
  // console.log(`  shieldedRoot: ${masterLog.args.masterShieldedRoot}`)
  // console.log(`  wormholeRoot: ${masterLog.args.masterWormholeRoot}`)
  console.log()

  console.log("Requesting Polymer proof of MasterTreesUpdated event...")
  const masterProof = await getPolymerProofHex({
    sourceChainId: MASTER_CHAIN_ID,
    blockNumber: masterBlockNumber,
    logIndex: masterLogIndex,
  })
  console.log(`Polymer proof received (${masterProof.length} hex chars)\n`)

  for (const branchChainId of BRANCH_CHAIN_IDS) {
    const label = getChain(branchChainId).label
    console.log(`[${label}] Submitting updateMasterTrees with master proof...`)

    try {
      const receipt = await sendUpdateMasterTrees(branchChainId, masterProof)
      console.log(`[${label}] Updated in block ${receipt.blockNumber}\n`)
    } catch (err) {
      console.error(`[${label}] Failed:`, err instanceof Error ? err.message : err)
      console.log()
    }
  }

  console.log("\n=== Done ===")
}

main().catch(err => {
  console.error("Fatal error:", err)
  process.exit(1)
})
