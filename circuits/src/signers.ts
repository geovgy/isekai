import { poseidon2Hash } from "@zkpassport/poseidon2"
import { bytesToHex, hashTypedData, hexToBytes, keccak256, stringToHex, toHex, type Address, type Hex } from "viem"
import type { SignerDelegation, SignerNote } from "./types"

const EIP712_DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
const SIGNER_DELEGATION_TYPE =
  "SignerDelegation(uint64 chainId,address owner,address delegate,uint64 startTime,uint64 endTime,address token,uint256 tokenId,uint256 amount,uint8 amountType,uint64 maxCumulativeAmount,uint64 maxNonce,uint64 timeInterval,uint8 transferType)"
const shieldedPoolDomain = (chainId: bigint, verifyingContract: Address) => ({
  name: "ShieldedPool",
  version: "1",
  chainId,
  verifyingContract,
} as const)
const signerDelegationTypes = {
  SignerDelegation: [
    { name: "chainId", type: "uint64" },
    { name: "owner", type: "address" },
    { name: "delegate", type: "address" },
    { name: "startTime", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "token", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "amountType", type: "uint8" },
    { name: "maxCumulativeAmount", type: "uint64" },
    { name: "maxNonce", type: "uint64" },
    { name: "timeInterval", type: "uint64" },
    { name: "transferType", type: "uint8" },
  ],
} as const

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0))
  let offset = 0
  for (const array of arrays) {
    result.set(array, offset)
    offset += array.length
  }
  return result
}

function bytes32(value: bigint): Uint8Array {
  return hexToBytes(toHex(value, { size: 32 }))
}

function splitHashWords(hash: Hex) {
  const hashBytes = hexToBytes(hash)
  return {
    hi: hashBytes.slice(0, 16),
    lo: hashBytes.slice(16, 32),
  }
}

export function getShieldedPoolDomainSeparator(chainId: bigint, verifyingContract: Address): Hex {
  return keccak256(
    concatBytes([
      hexToBytes(keccak256(stringToHex(EIP712_DOMAIN_TYPE))),
      hexToBytes(keccak256(stringToHex("ShieldedPool"))),
      hexToBytes(keccak256(stringToHex("1"))),
      bytes32(chainId),
      bytes32(BigInt(verifyingContract)),
    ])
  )
}

export function getShieldedPoolDomain(chainId: bigint, verifyingContract: Address) {
  return shieldedPoolDomain(chainId, verifyingContract)
}

export function getSignerDelegationTypehash(): Hex {
  return keccak256(stringToHex(SIGNER_DELEGATION_TYPE))
}

export function getSignerDelegationTypehashBytes(): number[] {
  return [...hexToBytes(getSignerDelegationTypehash())]
}

export function getSignerDelegationHash(
  chainId: bigint,
  verifyingContract: Address,
  delegation: SignerDelegation,
): Hex {
  return hashTypedData({
    domain: shieldedPoolDomain(chainId, verifyingContract),
    primaryType: "SignerDelegation",
    types: signerDelegationTypes,
    message: delegation,
  })
}


export function getSignerCommitment(delegateAddress: Address, ownerAddress: Address, delegationHash: Hex, signerNote: SignerNote): bigint {
  const delegationHashField = BigInt(delegationHash)
  return poseidon2Hash([
    BigInt(delegateAddress),
    BigInt(ownerAddress),
    delegationHashField,
    signerNote.total_amount,
    signerNote.nonce,
    signerNote.timestamp,
    signerNote.blinding,
  ])
}

export function getSignerNullifier(delegateAddress: Address, ownerAddress: Address, delegationHash: Hex, signerNote: Pick<SignerNote, "nonce">): bigint {
  const delegationHashField = BigInt(delegationHash)
  return poseidon2Hash([
    BigInt(delegateAddress),
    BigInt(ownerAddress),
    delegationHashField,
    signerNote.nonce,
  ])
}

export function getDelegatedPublicInputHashes(domainSeparator: Hex, messageHash: Hex) {
  const domainWords = splitHashWords(domainSeparator)
  const messageWords = splitHashWords(messageHash)

  return {
    eip712DomainHi: BigInt(bytesToHex(domainWords.hi)),
    eip712DomainLo: BigInt(bytesToHex(domainWords.lo)),
    hashedMessageHi: BigInt(bytesToHex(messageWords.hi)),
    hashedMessageLo: BigInt(bytesToHex(messageWords.lo)),
  }
}
