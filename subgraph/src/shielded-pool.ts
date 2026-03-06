import {
  Ragequit as RagequitEvent,
  VerifierAdded as VerifierAddedEvent,
  WormholeApproverSet as WormholeApproverSetEvent,
  WormholeCommitment as WormholeCommitmentEvent,
  WormholeEntry as WormholeEntryEvent,
  WormholeNullifier as WormholeNullifierEvent,
  WormholeTreeUpdated as WormholeTreeUpdatedEvent,
  MasterTreesUpdated as MasterTreesUpdatedEvent,
  MasterShieldedTreeLeaf as MasterShieldedTreeLeafEvent,
  MasterWormholeTreeLeaf as MasterWormholeTreeLeafEvent,
  BranchAdded as BranchAddedEvent
} from "../generated/ShieldedPool/ShieldedPool"
import {
  Ragequit,
  VerifierAdded,
  WormholeApprover,
  WormholeCommitment,
  WormholeEntry,
  WormholeNullifier,
  WormholeTree,
  Branch,
  BranchAdded,
  MasterTreesUpdated,
  MasterShieldedTreeLeaf,
  MasterWormholeTreeLeaf,
  MasterShieldedTree,
  MasterWormholeTree,
  BranchWormholeTreeSnapshot,
  MasterShieldedTreeSnapshot,
  MasterWormholeTreeSnapshot
} from "../generated/schema"
import { Address, BigInt, Bytes, DataSourceContext } from "@graphprotocol/graph-ts"
import { ShieldedPoolDelegateBranch as ShieldedPoolDelegateBranchTemplate } from "../generated/templates"

function stringId(parts: string[]): string {
  return parts.join(":")
}

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
  let id = stringId([event.params.treeId.toString(), event.params.leafIndex.toString()])
  let entity = new WormholeCommitment(id)
  entity.entry = stringId([event.params.entryId.toString()])
  entity.commitment = event.params.commitment
  entity.treeId = event.params.treeId
  entity.leafIndex = event.params.leafIndex
  entity.token = event.params.token
  entity.tokenId = event.params.tokenId
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
  let entry = WormholeEntry.load(stringId([event.params.entryId.toString()]))!
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
  let id = stringId([treeId.toString()])
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
    stringId([event.params.entryId.toString()])
  )
  entity.entryId = event.params.entryId
  entity.token = event.params.token
  entity.from = event.params.from
  entity.to = event.params.to
  entity.tokenId = event.params.id
  entity.amount = event.params.amount
  entity.confidentialContext = event.params.confidentialContext
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

export function handleWormholeTreeUpdated(event: WormholeTreeUpdatedEvent): void {
  let branchWormholeTree = WormholeTree.load(stringId([event.params.treeId.toString()]))
  let snapshotId = stringId([event.params.treeId.toString(), event.params.root.toString()])
  let snapshot = BranchWormholeTreeSnapshot.load(snapshotId)
  if (snapshot == null) {
    snapshot = new BranchWormholeTreeSnapshot(snapshotId)
    snapshot.treeId = event.params.treeId
    snapshot.root = event.params.root
    snapshot.leaves = branchWormholeTree ? branchWormholeTree.leaves : []
    snapshot.size = branchWormholeTree ? branchWormholeTree.size : BigInt.zero()
    snapshot.blockNumber = event.block.number
    snapshot.createdAt = event.block.timestamp
    snapshot.save()
  }
}

export function handleBranchAdded(event: BranchAddedEvent): void {
  let entity = new BranchAdded(event.transaction.hash.concatI32(event.logIndex.toI32()))
  entity.chainId = event.params.chainId
  entity.branch = event.params.branch
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  let branch = Branch.load(event.params.branch)
  if (branch == null) {
    branch = new Branch(event.params.branch)
    branch.address = event.params.branch
    branch.chainId = event.params.chainId
    branch.master = event.address
    branch.createdAt = event.block.timestamp
  }
  branch.updatedAt = event.block.timestamp
  branch.save()

  let context = new DataSourceContext()
  context.setBigInt("chainId", event.params.chainId)
  context.setBytes("branchAddress", event.params.branch)
  context.setBytes("masterAddress", event.address)
  ShieldedPoolDelegateBranchTemplate.createWithContext(Address.fromBytes(event.params.branch), context)
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

  let masterShieldedTree = MasterShieldedTree.load(stringId([event.params.shieldedTreeId.toString()]))
  let masterWormholeTree = MasterWormholeTree.load(stringId([event.params.wormholeTreeId.toString()]))

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
    stringId([
      event.params.treeId.toString(),
      event.params.branchRoot.toString(),
      event.params.branchChainId.toString(),
    ])
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
    stringId([
      event.params.treeId.toString(),
      event.params.branchRoot.toString(),
      event.params.branchChainId.toString(),
    ])
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
  let id = stringId([treeId.toString()])
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
  let id = stringId([treeId.toString()])
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
