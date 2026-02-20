import {
  Ragequit as RagequitEvent,
  ShieldedTransfer as ShieldedTransferEvent,
  VerifierAdded as VerifierAddedEvent,
  WormholeApproverSet as WormholeApproverSetEvent,
  WormholeCommitment as WormholeCommitmentEvent,
  WormholeEntry as WormholeEntryEvent,
  WormholeNullifier as WormholeNullifierEvent,
  BranchTreesUpdated as BranchTreesUpdatedEvent,
  MasterTreesUpdated as MasterTreesUpdatedEvent,
  MasterShieldedTreeLeaf as MasterShieldedTreeLeafEvent,
  MasterWormholeTreeLeaf as MasterWormholeTreeLeafEvent
} from "../generated/ShieldedPool/ShieldedPool"
import {
  Ragequit,
  ShieldedTransfer,
  ShieldedTree,
  ShieldNullifier,
  VerifierAdded,
  Withdrawal,
  WormholeApprover,
  WormholeCommitment,
  WormholeEntry,
  WormholeNullifier,
  WormholeTree,
  BranchTreesUpdated,
  MasterTreesUpdated,
  MasterShieldedTreeLeaf,
  MasterWormholeTreeLeaf,
  MasterShieldedTree,
  MasterWormholeTree,
  BranchWormholeTreeSnapshot,
  BranchShieldedTreeSnapshot,
  MasterShieldedTreeSnapshot,
  MasterWormholeTreeSnapshot
} from "../generated/schema"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"

export function handleRagequit(event: RagequitEvent): void {
  let entity = new Ragequit(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.entryId = event.params.entryId
  entity.quitter = event.params.quitter
  entity.returnedTo = event.params.returnedTo
  entity.token = event.params.asset
  entity.tokenId = event.params.id
  entity.amount = event.params.amount

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleShieldedTransfer(event: ShieldedTransferEvent): void {
  let entity = new ShieldedTransfer(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.treeId = event.params.treeId
  entity.startIndex = event.params.startIndex
  entity.commitments = event.params.commitments
  for (let i = 0; i < event.params.nullifiers.length; i++) {
    let nullifier = new ShieldNullifier(event.params.nullifiers[i])
    nullifier.nullifier = event.params.nullifiers[i]
    nullifier.save()
  }
  entity.nullifiers = event.params.nullifiers
  let baseId = entity.id.toHexString()
  let withdrawalIds = new Array<string>()
  for (let i = 0; i < event.params.withdrawals.length; i++) {
    let withdrawal = new Withdrawal(baseId + ":" + i.toString())
    withdrawal.to = event.params.withdrawals[i].to
    withdrawal.token = event.params.withdrawals[i].asset
    withdrawal.tokenId = event.params.withdrawals[i].id
    withdrawal.amount = event.params.withdrawals[i].amount
    withdrawal.save()
    withdrawalIds.push(withdrawal.id)
  }
  entity.withdrawals = withdrawalIds
  
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  
  entity.save()

  // Append to shielded tree
  let tree = _loadOrCreateShieldedTree(event.params.treeId, event.block.timestamp)
  let shieldedLeaves = tree.leaves
  for (let i = 0; i < event.params.commitments.length; i++) {
    shieldedLeaves.push(event.params.commitments[i])
  }
  tree.leaves = shieldedLeaves
  tree.size = BigInt.fromI32(shieldedLeaves.length)
  tree.updatedAt = event.block.timestamp
  tree.save()
}

function _loadOrCreateShieldedTree(treeId: BigInt, timestamp: BigInt): ShieldedTree {
  let id = Bytes.fromI32(treeId.toI32())
  let entity = ShieldedTree.load(id)
  if (entity == null) {
    entity = new ShieldedTree(id)
    entity.treeId = treeId
    entity.leaves = []
    entity.size = BigInt.zero()
    entity.createdAt = timestamp
    entity.updatedAt = timestamp
  }
  return entity
}

export function handleVerifierAdded(event: VerifierAddedEvent): void {
  let entity = new VerifierAdded(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.verifier = event.params.verifier
  entity.inputs = event.params.inputs
  entity.outputs = event.params.outputs

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleWormholeApproverSet(
  event: WormholeApproverSetEvent
): void {
  let entity = WormholeApprover.load(event.params.approver)
  if (entity == null) {
    entity = new WormholeApprover(event.params.approver)
    entity.address = event.params.approver
    entity.createdAt = event.block.timestamp
  }
  entity.isApprover = event.params.isApprover
  entity.updatedAt = event.block.timestamp
  entity.save()
}

export function handleWormholeCommitment(event: WormholeCommitmentEvent): void {
  let id = event.params.treeId.toString() + ":" + event.params.leafIndex.toString()
  let entity = new WormholeCommitment(id)
  entity.entry = Bytes.fromI32(event.params.entryId.toI32())
  entity.commitment = event.params.commitment
  entity.treeId = event.params.treeId
  entity.leafIndex = event.params.leafIndex
  entity.assetId = event.params.assetId
  entity.from = event.params.from
  entity.to = event.params.to
  entity.amount = event.params.amount
  entity.approved = event.params.approved
  entity.submittedBy = event.transaction.from

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // Update entry with commitment
  let entry = WormholeEntry.load(Bytes.fromI32(event.params.entryId.toI32()))!
  entry.submitted = true
  entry.save()

  // Append to wormhole tree
  let tree = _loadOrCreateWormholeTree(event.params.treeId, event.block.timestamp)
  let commitments = tree.commitments
  commitments.push(entity.id)
  tree.commitments = commitments
  let wormholeLeaves = tree.leaves
  wormholeLeaves.push(event.params.commitment)
  tree.leaves = wormholeLeaves
  tree.size = BigInt.fromI32(wormholeLeaves.length)
  tree.updatedAt = event.block.timestamp
  tree.save()
}

function _loadOrCreateWormholeTree(treeId: BigInt, timestamp: BigInt): WormholeTree {
  let id = Bytes.fromI32(treeId.toI32())
  let entity = WormholeTree.load(id)
  if (entity == null) {
    entity = new WormholeTree(id)
    entity.treeId = treeId
    entity.leaves = []
    entity.commitments = []
    entity.size = BigInt.zero()
    entity.createdAt = timestamp
    entity.updatedAt = timestamp
  }
  return entity
}

export function handleWormholeEntry(event: WormholeEntryEvent): void {
  let entity = new WormholeEntry(
    Bytes.fromI32(event.params.entryId.toI32())
  )
  entity.entryId = event.params.entryId
  entity.token = event.params.token
  entity.from = event.params.from
  entity.to = event.params.to
  entity.tokenId = event.params.id
  entity.amount = event.params.amount
  entity.submitted = false

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleWormholeNullifier(event: WormholeNullifierEvent): void {
  let entity = new WormholeNullifier(event.params.nullifier)
  entity.nullifier = event.params.nullifier

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleBranchTreesUpdated(event: BranchTreesUpdatedEvent): void {
  let entity = new BranchTreesUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.logIndex = event.logIndex
  entity.shieldedTreeId = event.params.shieldedTreeId
  entity.wormholeTreeId = event.params.wormholeTreeId
  entity.branchShieldedRoot = event.params.branchShieldedRoot
  entity.branchWormholeRoot = event.params.branchWormholeRoot

  entity.branchBlockNumber = event.params.blockNumber
  entity.branchBlockTimestamp = event.params.blockTimestamp
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  // Get branch trees
  let branchShieldedTree = ShieldedTree.load(Bytes.fromI32(event.params.shieldedTreeId.toI32()))
  let branchWormholeTree = WormholeTree.load(Bytes.fromI32(event.params.wormholeTreeId.toI32()))

  // Create branch wormhole tree snapshot only if it doesn't exist.
  // The same root can be emitted in multiple BranchTreesUpdated events (e.g. when only
  // the shielded tree changes). Creating a duplicate immutable entity causes "Failed to
  // transact block operations".
  let wormholeSnapshotId = event.params.wormholeTreeId.toString() + ":" + event.params.branchWormholeRoot.toString()
  let branchWormholeTreeSnapshot = BranchWormholeTreeSnapshot.load(wormholeSnapshotId)
  if (branchWormholeTreeSnapshot == null) {
    branchWormholeTreeSnapshot = new BranchWormholeTreeSnapshot(wormholeSnapshotId)
    branchWormholeTreeSnapshot.treeId = event.params.wormholeTreeId
    branchWormholeTreeSnapshot.root = event.params.branchWormholeRoot
    branchWormholeTreeSnapshot.leaves = branchWormholeTree ? branchWormholeTree.leaves : []
    branchWormholeTreeSnapshot.size = branchWormholeTree ? branchWormholeTree.size : BigInt.zero()
    branchWormholeTreeSnapshot.blockNumber = event.block.number
    branchWormholeTreeSnapshot.createdAt = event.block.timestamp
    branchWormholeTreeSnapshot.save()
  }

  // Create branch shielded tree snapshot only if it doesn't exist.
  let shieldedSnapshotId = event.params.shieldedTreeId.toString() + ":" + event.params.branchShieldedRoot.toString()
  let branchShieldedTreeSnapshot = BranchShieldedTreeSnapshot.load(shieldedSnapshotId)
  if (branchShieldedTreeSnapshot == null) {
    branchShieldedTreeSnapshot = new BranchShieldedTreeSnapshot(shieldedSnapshotId)
    branchShieldedTreeSnapshot.treeId = event.params.shieldedTreeId
    branchShieldedTreeSnapshot.root = event.params.branchShieldedRoot
    branchShieldedTreeSnapshot.leaves = branchShieldedTree ? branchShieldedTree.leaves : []
    branchShieldedTreeSnapshot.size = branchShieldedTree ? branchShieldedTree.size : BigInt.zero()
    branchShieldedTreeSnapshot.blockNumber = event.block.number
    branchShieldedTreeSnapshot.createdAt = event.block.timestamp
    branchShieldedTreeSnapshot.save()
  }
}

export function handleMasterTreesUpdated(event: MasterTreesUpdatedEvent): void {
  let entity = new MasterTreesUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.logIndex = event.logIndex
  entity.masterShieldedTreeId = event.params.shieldedTreeId
  entity.masterWormholeTreeId = event.params.wormholeTreeId
  entity.masterShieldedRoot = event.params.masterShieldedRoot
  entity.masterWormholeRoot = event.params.masterWormholeRoot
  entity.masterBlockNumber = event.params.blockNumber
  entity.masterBlockTimestamp = event.params.blockTimestamp
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()

  let masterShieldedTree = MasterShieldedTree.load(Bytes.fromI32(event.params.shieldedTreeId.toI32()))
  let masterWormholeTree = MasterWormholeTree.load(Bytes.fromI32(event.params.wormholeTreeId.toI32()))

  // Create master shielded tree snapshot
  let masterShieldedTreeSnapshotId = event.params.shieldedTreeId.toString() + ":" + event.params.masterShieldedRoot.toString()
  let masterShieldedTreeSnapshot = MasterShieldedTreeSnapshot.load(masterShieldedTreeSnapshotId)
  if (masterShieldedTreeSnapshot == null) {
    masterShieldedTreeSnapshot = new MasterShieldedTreeSnapshot(masterShieldedTreeSnapshotId)
    masterShieldedTreeSnapshot.treeId = event.params.shieldedTreeId
    masterShieldedTreeSnapshot.root = event.params.masterShieldedRoot
    masterShieldedTreeSnapshot.leaves = masterShieldedTree ? masterShieldedTree.leaves : []
    masterShieldedTreeSnapshot.size = masterShieldedTree ? masterShieldedTree.size : BigInt.zero()
    masterShieldedTreeSnapshot.blockNumber = event.block.number
    masterShieldedTreeSnapshot.createdAt = event.block.timestamp
    masterShieldedTreeSnapshot.save()
  }

  // Create master wormhole tree snapshot
  let masterWormholeTreeSnapshotId = event.params.wormholeTreeId.toString() + ":" + event.params.masterWormholeRoot.toString()
  let masterWormholeTreeSnapshot = MasterWormholeTreeSnapshot.load(masterWormholeTreeSnapshotId)
  if (masterWormholeTreeSnapshot == null) {
    masterWormholeTreeSnapshot = new MasterWormholeTreeSnapshot(masterWormholeTreeSnapshotId)
    masterWormholeTreeSnapshot.treeId = event.params.wormholeTreeId
    masterWormholeTreeSnapshot.root = event.params.masterWormholeRoot
    masterWormholeTreeSnapshot.leaves = masterWormholeTree ? masterWormholeTree.leaves : []
    masterWormholeTreeSnapshot.size = masterWormholeTree ? masterWormholeTree.size : BigInt.zero()
    masterWormholeTreeSnapshot.blockNumber = event.block.number
    masterWormholeTreeSnapshot.createdAt = event.block.timestamp
    masterWormholeTreeSnapshot.save()
  }
}

export function handleMasterShieldedTreeLeaf(event: MasterShieldedTreeLeafEvent): void {
  let entity = new MasterShieldedTreeLeaf(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.treeId = event.params.treeId
  entity.branchRoot = event.params.branchRoot
  entity.branchChainId = event.params.branchChainId
  entity.branchBlockNumber = event.params.branchBlockNumber
  entity.branchTimestamp = event.params.branchTimestamp
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp

  entity.save()

  let tree = _loadOrCreateMasterShieldedTree(event.params.treeId, event.block.timestamp)
  let leaves = tree.leaves
  leaves.push(event.params.branchRoot)
  tree.leaves = leaves
  tree.size = BigInt.fromI32(leaves.length)
  tree.updatedAt = event.block.timestamp
  tree.save()
}

export function handleMasterWormholeTreeLeaf(event: MasterWormholeTreeLeafEvent): void {
  let entity = new MasterWormholeTreeLeaf(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.treeId = event.params.treeId
  entity.branchRoot = event.params.branchRoot
  entity.branchChainId = event.params.branchChainId
  entity.branchBlockNumber = event.params.branchBlockNumber
  entity.branchTimestamp = event.params.branchTimestamp
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp

  entity.save()

  let tree = _loadOrCreateMasterWormholeTree(event.params.treeId, event.block.timestamp)
  let leaves = tree.leaves
  leaves.push(event.params.branchRoot)
  tree.leaves = leaves
  tree.size = BigInt.fromI32(leaves.length)
  tree.updatedAt = event.block.timestamp
  tree.save()
}

function _loadOrCreateMasterShieldedTree(treeId: BigInt, timestamp: BigInt): MasterShieldedTree {
  let id = Bytes.fromI32(treeId.toI32())
  let entity = MasterShieldedTree.load(id)
  if (entity == null) {
    entity = new MasterShieldedTree(id)
    entity.treeId = treeId
    entity.leaves = []
    entity.size = BigInt.zero()
    entity.createdAt = timestamp
    entity.updatedAt = timestamp
  }
  return entity
}

function _loadOrCreateMasterWormholeTree(treeId: BigInt, timestamp: BigInt): MasterWormholeTree {
  let id = Bytes.fromI32(treeId.toI32())
  let entity = MasterWormholeTree.load(id)
  if (entity == null) {
    entity = new MasterWormholeTree(id)
    entity.treeId = treeId
    entity.leaves = []
    entity.size = BigInt.zero()
    entity.createdAt = timestamp
    entity.updatedAt = timestamp
  }
  return entity
}
