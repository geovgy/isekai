import { newMockEvent } from "matchstick-as"
import { ethereum, Address, Bytes, BigInt } from "@graphprotocol/graph-ts"
import {
  Ragequit,
  ShieldedTransfer,
  VerifierAdded,
  WormholeApproverSet,
  WormholeCommitment,
  WormholeEntry,
  WormholeNullifier,
  BranchTreesUpdated,
  MasterTreesUpdated
} from "../generated/ShieldedPool/ShieldedPool"

export function createRagequitEvent(
  entryId: BigInt,
  quitter: Address,
  returnedTo: Address,
  asset: Address,
  id: BigInt,
  amount: BigInt
): Ragequit {
  let ragequitEvent = changetype<Ragequit>(newMockEvent())

  ragequitEvent.parameters = new Array()

  ragequitEvent.parameters.push(
    new ethereum.EventParam(
      "entryId",
      ethereum.Value.fromUnsignedBigInt(entryId)
    )
  )
  ragequitEvent.parameters.push(
    new ethereum.EventParam("quitter", ethereum.Value.fromAddress(quitter))
  )
  ragequitEvent.parameters.push(
    new ethereum.EventParam(
      "returnedTo",
      ethereum.Value.fromAddress(returnedTo)
    )
  )
  ragequitEvent.parameters.push(
    new ethereum.EventParam("asset", ethereum.Value.fromAddress(asset))
  )
  ragequitEvent.parameters.push(
    new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id))
  )
  ragequitEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return ragequitEvent
}

export function createShieldedTransferEvent(
  treeId: BigInt,
  startIndex: BigInt,
  commitments: Array<BigInt>,
  nullifiers: Array<Bytes>,
  withdrawals: Array<ethereum.Tuple>
): ShieldedTransfer {
  let shieldedTransferEvent = changetype<ShieldedTransfer>(newMockEvent())

  shieldedTransferEvent.parameters = new Array()

  shieldedTransferEvent.parameters.push(
    new ethereum.EventParam("treeId", ethereum.Value.fromUnsignedBigInt(treeId))
  )
  shieldedTransferEvent.parameters.push(
    new ethereum.EventParam(
      "startIndex",
      ethereum.Value.fromUnsignedBigInt(startIndex)
    )
  )
  shieldedTransferEvent.parameters.push(
    new ethereum.EventParam(
      "commitments",
      ethereum.Value.fromUnsignedBigIntArray(commitments)
    )
  )
  shieldedTransferEvent.parameters.push(
    new ethereum.EventParam(
      "nullifiers",
      ethereum.Value.fromFixedBytesArray(nullifiers)
    )
  )
  shieldedTransferEvent.parameters.push(
    new ethereum.EventParam(
      "withdrawals",
      ethereum.Value.fromTupleArray(withdrawals)
    )
  )

  return shieldedTransferEvent
}

export function createVerifierAddedEvent(
  verifier: Address,
  inputs: BigInt,
  outputs: BigInt
): VerifierAdded {
  let verifierAddedEvent = changetype<VerifierAdded>(newMockEvent())

  verifierAddedEvent.parameters = new Array()

  verifierAddedEvent.parameters.push(
    new ethereum.EventParam("verifier", ethereum.Value.fromAddress(verifier))
  )
  verifierAddedEvent.parameters.push(
    new ethereum.EventParam("inputs", ethereum.Value.fromUnsignedBigInt(inputs))
  )
  verifierAddedEvent.parameters.push(
    new ethereum.EventParam(
      "outputs",
      ethereum.Value.fromUnsignedBigInt(outputs)
    )
  )

  return verifierAddedEvent
}

export function createWormholeApproverSetEvent(
  approver: Address,
  isApprover: boolean
): WormholeApproverSet {
  let wormholeApproverSetEvent = changetype<WormholeApproverSet>(newMockEvent())

  wormholeApproverSetEvent.parameters = new Array()

  wormholeApproverSetEvent.parameters.push(
    new ethereum.EventParam("approver", ethereum.Value.fromAddress(approver))
  )
  wormholeApproverSetEvent.parameters.push(
    new ethereum.EventParam(
      "isApprover",
      ethereum.Value.fromBoolean(isApprover)
    )
  )

  return wormholeApproverSetEvent
}

export function createWormholeCommitmentEvent(
  entryId: BigInt,
  commitment: BigInt,
  treeId: BigInt,
  leafIndex: BigInt,
  assetId: Bytes,
  from: Address,
  to: Address,
  amount: BigInt,
  approved: boolean
): WormholeCommitment {
  let wormholeCommitmentEvent = changetype<WormholeCommitment>(newMockEvent())

  wormholeCommitmentEvent.parameters = new Array()

  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam(
      "entryId",
      ethereum.Value.fromUnsignedBigInt(entryId)
    )
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam(
      "commitment",
      ethereum.Value.fromUnsignedBigInt(commitment)
    )
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam("treeId", ethereum.Value.fromUnsignedBigInt(treeId))
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam(
      "leafIndex",
      ethereum.Value.fromUnsignedBigInt(leafIndex)
    )
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam("assetId", ethereum.Value.fromFixedBytes(assetId))
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )
  wormholeCommitmentEvent.parameters.push(
    new ethereum.EventParam("approved", ethereum.Value.fromBoolean(approved))
  )

  return wormholeCommitmentEvent
}

export function createWormholeEntryEvent(
  entryId: BigInt,
  token: Address,
  from: Address,
  to: Address,
  id: BigInt,
  amount: BigInt
): WormholeEntry {
  let wormholeEntryEvent = changetype<WormholeEntry>(newMockEvent())

  wormholeEntryEvent.parameters = new Array()

  wormholeEntryEvent.parameters.push(
    new ethereum.EventParam(
      "entryId",
      ethereum.Value.fromUnsignedBigInt(entryId)
    )
  )
  wormholeEntryEvent.parameters.push(
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token))
  )
  wormholeEntryEvent.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from))
  )
  wormholeEntryEvent.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to))
  )
  wormholeEntryEvent.parameters.push(
    new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id))
  )
  wormholeEntryEvent.parameters.push(
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount))
  )

  return wormholeEntryEvent
}

export function createWormholeNullifierEvent(
  nullifier: Bytes
): WormholeNullifier {
  let wormholeNullifierEvent = changetype<WormholeNullifier>(newMockEvent())

  wormholeNullifierEvent.parameters = new Array()

  wormholeNullifierEvent.parameters.push(
    new ethereum.EventParam(
      "nullifier",
      ethereum.Value.fromFixedBytes(nullifier)
    )
  )

  return wormholeNullifierEvent
}

export function createBranchTreesUpdatedEvent(
  shieldedTreeId: BigInt,
  wormholeTreeId: BigInt,
  branchShieldedRoot: BigInt,
  branchWormholeRoot: BigInt,
  blockNumber: BigInt,
  blockTimestamp: BigInt
): BranchTreesUpdated {
  let event = changetype<BranchTreesUpdated>(newMockEvent())

  event.parameters = new Array()

  event.parameters.push(
    new ethereum.EventParam("shieldedTreeId", ethereum.Value.fromUnsignedBigInt(shieldedTreeId))
  )
  event.parameters.push(
    new ethereum.EventParam("wormholeTreeId", ethereum.Value.fromUnsignedBigInt(wormholeTreeId))
  )
  event.parameters.push(
    new ethereum.EventParam("branchShieldedRoot", ethereum.Value.fromUnsignedBigInt(branchShieldedRoot))
  )
  event.parameters.push(
    new ethereum.EventParam("branchWormholeRoot", ethereum.Value.fromUnsignedBigInt(branchWormholeRoot))
  )
  event.parameters.push(
    new ethereum.EventParam("blockNumber", ethereum.Value.fromUnsignedBigInt(blockNumber))
  )
  event.parameters.push(
    new ethereum.EventParam("blockTimestamp", ethereum.Value.fromUnsignedBigInt(blockTimestamp))
  )

  return event
}

export function createMasterTreesUpdatedEvent(
  masterShieldedRoot: BigInt,
  masterWormholeRoot: BigInt,
  blockNumber: BigInt,
  blockTimestamp: BigInt
): MasterTreesUpdated {
  let event = changetype<MasterTreesUpdated>(newMockEvent())

  event.parameters = new Array()

  event.parameters.push(
    new ethereum.EventParam("masterShieldedRoot", ethereum.Value.fromUnsignedBigInt(masterShieldedRoot))
  )
  event.parameters.push(
    new ethereum.EventParam("masterWormholeRoot", ethereum.Value.fromUnsignedBigInt(masterWormholeRoot))
  )
  event.parameters.push(
    new ethereum.EventParam("blockNumber", ethereum.Value.fromUnsignedBigInt(blockNumber))
  )
  event.parameters.push(
    new ethereum.EventParam("blockTimestamp", ethereum.Value.fromUnsignedBigInt(blockTimestamp))
  )

  return event
}
