import { ConfidentialType, TransferType, type InputNote, type OutputNote, type WormholeNote } from "./types";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import { bytesToHex, stringToHex, toBytes, toHex, type Address } from "viem";

export function getRecipientHash(chainId: bigint, recipient: Address, blinding: bigint): bigint {
  return poseidon2Hash([chainId, BigInt(recipient), blinding]);
}

export function getCommitment(token: bigint, tokenId: bigint, outputNote: OutputNote): bigint {
  if ((outputNote.chain_id === 0n && outputNote.blinding === 0n) || outputNote.transfer_type === TransferType.WITHDRAWAL) {
    return BigInt(outputNote.recipient);
  }
  const recipient = typeof outputNote.recipient === "bigint" ? toHex(outputNote.recipient) : outputNote.recipient;
  return poseidon2Hash([getRecipientHash(outputNote.chain_id, recipient, outputNote.blinding), token, tokenId, outputNote.amount, BigInt(outputNote.transfer_type)]);
}

export function getNullifier(chainId: bigint, branchRoot: bigint, ownerAddress: Address, token: bigint, tokenId: bigint, inputNote: InputNote): bigint {
  const secretCommitment = poseidon2Hash([BigInt(ownerAddress), token, tokenId, inputNote.amount]);
  return poseidon2Hash([chainId, branchRoot, inputNote.branch_index, inputNote.blinding, secretCommitment]);
}

export function getWormholeBurnAddress(chainId: bigint, recipient: Address, wormholeSecret: bigint): Address {
  const hash = poseidon2Hash([chainId, BigInt(recipient), wormholeSecret, BigInt(stringToHex("ZKWORMHOLE"))]);
  return bytesToHex(toBytes(hash,{ size: 32 }).slice(12, 32));
}

export function getWormholeBurnAddressForNote(args: WormholeNote): Address | bigint {
  if (args.confidential_type === ConfidentialType.NONE) {
    return getWormholeBurnAddress(args.dst_chain_id, args.recipient, args.wormhole_secret);
  }
  return BigInt(args.to);
}

export function getConfidentialContext(args: WormholeNote): bigint {
  if (args.confidential_type === ConfidentialType.NONE) {
    return 0n;
  } else if (args.confidential_type === ConfidentialType.PARTIAL) {
    const blindedRecipient = poseidon2Hash([BigInt(args.recipient), args.wormhole_secret]);
    return poseidon2Hash([blindedRecipient, 0x01n]);
  } else {
    let blindedRecipient = poseidon2Hash([BigInt(args.recipient), args.wormhole_secret]);
    blindedRecipient = poseidon2Hash([blindedRecipient, 0x01n]);
    return poseidon2Hash([blindedRecipient, BigInt(args.from), args.token, args.token_id, args.amount]);
  }
}

export function getWormholeBurnCommitment(args: WormholeNote & {
  approved: boolean;
}): bigint {
  const burnAddress = getWormholeBurnAddressForNote(args);
  const confidentialContext = getConfidentialContext(args);
  const idHash = poseidon2Hash([args.src_chain_id, args.entry_id]);
  const token = args.confidential_type === ConfidentialType.FULL ? 0n : args.token;
  const tokenId = args.confidential_type === ConfidentialType.FULL ? 0n : args.token_id;
  const amount = args.confidential_type === ConfidentialType.FULL ? 0n : args.amount;
  return poseidon2Hash([idHash, BigInt(args.approved), BigInt(args.from), BigInt(burnAddress), token, tokenId, amount, confidentialContext]);
}

export function getWormholeNullifier(args: WormholeNote): bigint {
  const secretCommitment = poseidon2Hash([BigInt(args.recipient), args.token, args.token_id, BigInt(args.from), args.amount]);
  const idHash = poseidon2Hash([args.src_chain_id, args.entry_id]);
  return poseidon2Hash([1n, idHash, args.wormhole_secret, secretCommitment]);
}

export function getWormholePseudoNullifier(chainId: bigint, address: Address, token: bigint, tokenId: bigint, secret: bigint): bigint {
  const pseudoCommitment = poseidon2Hash([BigInt(address), token, tokenId, 0n, 0n]);
  return poseidon2Hash([1n, chainId, secret, pseudoCommitment]);
}