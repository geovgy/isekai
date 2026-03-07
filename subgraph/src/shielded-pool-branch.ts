import {
  ShieldedTransfer as BranchShieldedTransferEvent,
  ShieldedTreeUpdated as BranchShieldedTreeUpdatedEvent,
  VerifierAdded as BranchVerifierAddedEvent,
} from "../generated/templates/ShieldedPoolBranch/ShieldedPoolBranch"
import {
  Branch,
  ShieldedTransfer,
  ShieldNullifier,
  Withdrawal,
  BranchVerifierAdded,
  BranchShieldedTree,
  BranchShieldedTreeSnapshot,
  BranchShieldedTreeUpdate,
} from "../generated/schema"
import { BigInt, dataSource } from "@graphprotocol/graph-ts"

function stringId(parts: string[]): string {
  return parts.join(":")
}

function branchScopedId(branch: Branch, parts: string[]): string {
  return stringId([branch.address.toHexString(), branch.chainId.toString()].concat(parts))
}

function branchSnapshotId(branch: Branch, parts: string[]): string {
  return stringId([branch.address.toHexString()].concat(parts))
}

function loadOrCreateBranch(timestamp: BigInt): Branch {
  let context = dataSource.context()
  let branchAddress = context.getBytes("branchAddress")
  let branch = Branch.load(branchAddress)
  if (branch == null) {
    branch = new Branch(branchAddress)
    branch.address = branchAddress
    branch.chainId = context.getBigInt("chainId")
    branch.master = context.getBytes("masterAddress")
    branch.createdAt = timestamp
  }
  branch.updatedAt = timestamp
  branch.save()
  return branch
}

function loadOrCreateBranchShieldedTree(branch: Branch, treeId: BigInt, timestamp: BigInt): BranchShieldedTree {
  let id = branchScopedId(branch, [treeId.toString()])
  let tree = BranchShieldedTree.load(id)
  if (tree == null) {
    tree = new BranchShieldedTree(id)
    tree.branch = branch.id
    tree.treeId = treeId
    tree.roots = []
    tree.size = BigInt.zero()
    tree.createdAt = timestamp
  }
  tree.updatedAt = timestamp
  return tree
}

export function handleBranchShieldedTransfer(event: BranchShieldedTransferEvent): void {
  let branch = loadOrCreateBranch(event.block.timestamp)
  let entityId = branchScopedId(branch, [
    event.params.treeId.toString(),
    event.params.startIndex.toString(),
  ])
  let entity = new ShieldedTransfer(entityId)
  entity.branch = branch.id
  entity.treeId = event.params.treeId
  entity.startIndex = event.params.startIndex
  entity.commitments = event.params.commitments

  for (let i = 0; i < event.params.nullifiers.length; i++) {
    let nullifier = new ShieldNullifier(event.params.nullifiers[i])
    nullifier.nullifier = event.params.nullifiers[i]
    nullifier.save()
  }
  entity.nullifiers = event.params.nullifiers

  let withdrawalIds = new Array<string>()
  for (let i = 0; i < event.params.withdrawals.length; i++) {
    let withdrawal = new Withdrawal(entityId + ":" + i.toString())
    withdrawal.to = event.params.withdrawals[i].to
    withdrawal.token = event.params.withdrawals[i].asset
    withdrawal.tokenId = event.params.withdrawals[i].id
    withdrawal.amount = event.params.withdrawals[i].amount
    withdrawal.confidentialContext = event.params.withdrawals[i].confidentialContext
    withdrawal.save()
    withdrawalIds.push(withdrawal.id)
  }
  entity.withdrawals = withdrawalIds

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleBranchShieldedTreeUpdated(event: BranchShieldedTreeUpdatedEvent): void {
  let branch = loadOrCreateBranch(event.block.timestamp)
  let entity = new BranchShieldedTreeUpdate(branchScopedId(branch, [
    event.params.shieldedTreeId.toString(),
    event.params.shieldedRoot.toString(),
  ]))
  entity.branch = branch.id
  entity.treeId = event.params.shieldedTreeId
  entity.root = event.params.shieldedRoot
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  let tree = loadOrCreateBranchShieldedTree(branch, event.params.shieldedTreeId, event.block.timestamp)
  let roots = tree.roots
  roots.push(event.params.shieldedRoot)
  tree.roots = roots
  tree.size = BigInt.fromI32(roots.length)
  tree.save()

  let snapshotId = branchSnapshotId(branch, [
    event.params.shieldedTreeId.toString(),
    event.params.shieldedRoot.toString(),
  ])
  let snapshot = BranchShieldedTreeSnapshot.load(snapshotId)
  if (snapshot == null) {
    snapshot = new BranchShieldedTreeSnapshot(snapshotId)
    snapshot.branch = branch.id
    snapshot.treeId = event.params.shieldedTreeId
    snapshot.root = event.params.shieldedRoot
    snapshot.leaves = tree.roots
    snapshot.size = tree.size
    snapshot.blockNumber = event.block.number
    snapshot.createdAt = event.block.timestamp
    snapshot.save()
  }
}

export function handleBranchVerifierAdded(event: BranchVerifierAddedEvent): void {
  let branch = loadOrCreateBranch(event.block.timestamp)
  let entity = new BranchVerifierAdded(event.transaction.hash.concatI32(event.logIndex.toI32()))
  entity.branch = branch.id
  entity.verifier = event.params.verifier
  entity.inputs = event.params.inputs
  entity.outputs = event.params.outputs
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}
