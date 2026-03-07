import {
  ShieldedTransferSigner as BranchShieldedTransferSignerEvent,
  SignerTreeUpdated as SignerTreeUpdatedEvent,
} from "../generated/templates/ShieldedPoolDelegateBranch/ShieldedPoolDelegateBranch"
import { Branch, ShieldedTransferSigner, SignerTree, SignerTreeUpdate } from "../generated/schema"
import { BigInt, dataSource } from "@graphprotocol/graph-ts"

function stringId(parts: string[]): string {
  return parts.join(":")
}

function branchScopedId(branch: Branch, parts: string[]): string {
  return stringId([branch.address.toHexString(), branch.chainId.toString()].concat(parts))
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

function loadOrCreateSignerTree(branch: Branch, treeId: BigInt, timestamp: BigInt): SignerTree {
  let id = branchScopedId(branch, [treeId.toString()])
  let tree = SignerTree.load(id)
  if (tree == null) {
    tree = new SignerTree(id)
    tree.branch = branch.id
    tree.branchAddress = branch.address
    tree.treeId = treeId
    tree.roots = []
    tree.size = BigInt.zero()
    tree.createdAt = timestamp
  }
  tree.updatedAt = timestamp
  return tree
}

export function handleBranchShieldedTransferSigner(event: BranchShieldedTransferSignerEvent): void {
  let branch = loadOrCreateBranch(event.block.timestamp)
  let shieldedTransferId = branchScopedId(branch, [
    event.params.treeId.toString(),
    event.params.startIndex.toString(),
  ])
  let entity = new ShieldedTransferSigner(shieldedTransferId)
  entity.branch = branch.id
  entity.shieldedTransfer = shieldedTransferId
  entity.signerCommitment = event.params.signerCommitment
  entity.signerNullifier = event.params.signerNullifier
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleSignerTreeUpdated(event: SignerTreeUpdatedEvent): void {
  let branch = loadOrCreateBranch(event.block.timestamp)
  let entity = new SignerTreeUpdate(branchScopedId(branch, [
    event.params.signerTreeId.toString(),
    event.params.signerRoot.toString(),
  ]))
  entity.branch = branch.id
  entity.treeId = event.params.signerTreeId
  entity.root = event.params.signerRoot
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  let tree = loadOrCreateSignerTree(branch, event.params.signerTreeId, event.block.timestamp)
  let roots = tree.roots
  roots.push(event.params.signerRoot)
  tree.roots = roots
  tree.size = BigInt.fromI32(roots.length)
  tree.save()
}
