import { describe, expect, it } from "bun:test";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import { getMerkleTree } from "../src/merkle";
import { Prover } from "../src/prover";
import { getDelegatedPublicInputHashes, getShieldedPoolDomainSeparator, getSignerDelegationHash, getSignerDelegationTypehashBytes, getSignerNullifier } from "../src/signers";
import { type SignerDelegation, type SignerNote } from "../src/types";
import { hashMessage, hexToBytes, recoverPublicKey, toHex, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function extractPublicInputs(result: string[]) {
  return {
    eip712DomainLo: result[0]!,
    eip712DomainHi: result[1]!,
    signerRoot: result[2]!,
    returnedHashedMessageHi: result[3]!,
    returnedHashedMessageLo: result[4]!,
    returnedDelegationHashHi: result[5]!,
    returnedDelegationHashLo: result[6]!,
    signerCommitment: result[7]!,
    signerNullifier: result[8]!,
  };
}

function splitHashWords(hash: `0x${string}`) {
  const hashBytes = hexToBytes(hash);
  return {
    hi: BigInt(toHex(hashBytes.slice(0, 16))),
    lo: BigInt(toHex(hashBytes.slice(16, 32))),
  };
}

function getSignerCommitment(
  delegateAddress: `0x${string}`,
  ownerAddress: `0x${string}`,
  delegationHash: `0x${string}`,
  signerNote: SignerNote,
  valid: boolean,
) {
  return poseidon2Hash([
    BigInt(delegateAddress),
    BigInt(ownerAddress),
    BigInt(delegationHash),
    signerNote.total_amount,
    signerNote.nonce,
    signerNote.timestamp,
    signerNote.blinding,
    BigInt(valid),
  ]);
}

describe("revoke_delegation", () => {
  const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const delegate = privateKeyToAccount("0x1000000000000000000000000000000000000000000000000000000000000001");
  const verifyingContract = "0x0000000000000000000000000000000000001000";
  const tokenAddress = "0x0000000000000000000000000000000000000001";
  const chainId = 1n;
  const signerBlinding = 999n;
  const signerDelegationTypehashBytes = getSignerDelegationTypehashBytes();
  const domainSeparator = getShieldedPoolDomainSeparator(chainId, verifyingContract);

  it("should revoke an existing signer delegation", async () => {
    const delegation: SignerDelegation = {
      chainId,
      owner: owner.address,
      delegate: delegate.address,
      recipient: zeroAddress,
      recipientLocked: false,
      startTime: 0n,
      endTime: 0n,
      token: tokenAddress,
      tokenId: 0n,
      amount: 150n,
      amountType: 0,
      maxCumulativeAmount: 0n,
      maxNonce: 0n,
      timeInterval: 0n,
      transferType: 0,
    };

    const unsignedSignerNote: SignerNote = {
      index: 0n,
      siblings: [],
      total_amount: 150n,
      nonce: 1n,
      timestamp: 1_000n,
      blinding: 777n,
    };

    const delegationHash = getSignerDelegationHash(chainId, verifyingContract, delegation);
    const existingSignerCommitment = getSignerCommitment(
      delegate.address,
      owner.address,
      delegationHash,
      unsignedSignerNote,
      true,
    );
    const signerTree = getMerkleTree([existingSignerCommitment]);
    const signerProof = signerTree.generateProof(0);

    const signerNote: SignerNote = {
      ...unsignedSignerNote,
      index: BigInt(signerProof.index),
      siblings: signerProof.siblings,
    };

    const message = `Revoke delegation: ${delegationHash}`;
    const hashedMessage = hashMessage(message);
    const signature = await owner.signMessage({ message: `Revoke delegation: ${delegationHash}` });
    const publicKey = await recoverPublicKey({ hash: hashedMessage, signature });
    const publicHashes = getDelegatedPublicInputHashes(domainSeparator, hashedMessage);
    const hashedMessageWords = splitHashWords(hashedMessage);
    const delegationHashWords = splitHashWords(delegationHash);
    const expectedSignerNullifier = getSignerNullifier(delegate.address, owner.address, delegationHash, signerNote);
    const revokedSignerNote: SignerNote = {
      ...signerNote,
      nonce: signerNote.nonce + 1n,
      blinding: signerBlinding,
    };
    const expectedSignerCommitment = getSignerCommitment(
      delegate.address,
      owner.address,
      delegationHash,
      revokedSignerNote,
      false,
    );

    const circuitInputs = {
      eip712_domain_lo: publicHashes.eip712DomainLo.toString(),
      eip712_domain_hi: publicHashes.eip712DomainHi.toString(),
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)],
      hashed_message: [...hexToBytes(hashedMessage)],
      signer_root: signerTree.root.toString(),
      signer_note: {
        index: signerNote.index.toString(),
        siblings: signerNote.siblings.map((sibling) => sibling.toString()).concat(Array(20 - signerNote.siblings.length).fill("0")),
        total_amount: signerNote.total_amount.toString(),
        nonce: signerNote.nonce.toString(),
        timestamp: signerNote.timestamp.toString(),
        blinding: signerNote.blinding.toString(),
      },
      signer_blinding: signerBlinding.toString(),
      delegation_typehash: signerDelegationTypehashBytes,
      delegation: {
        chainId: delegation.chainId.toString(),
        owner: delegation.owner,
        delegate: delegation.delegate,
        recipient: delegation.recipient,
        recipientLocked: delegation.recipientLocked,
        startTime: delegation.startTime.toString(),
        endTime: delegation.endTime.toString(),
        token: delegation.token,
        tokenId: delegation.tokenId.toString(),
        amount: delegation.amount.toString(),
        amountType: delegation.amountType,
        maxCumulativeAmount: delegation.maxCumulativeAmount.toString(),
        maxNonce: delegation.maxNonce.toString(),
        timeInterval: delegation.timeInterval.toString(),
        transferType: delegation.transferType,
      },
    };

    const prover = new Prover("revoke_delegation");

    console.time("prove");
    const result = await prover.prove(circuitInputs);
    console.timeEnd("prove");

    console.time("verify");
    const isValid = await prover.verify(result);
    console.timeEnd("verify");
    expect(isValid).toBe(true);

    const actual = extractPublicInputs(result.publicInputs);
    expect(actual.eip712DomainLo).toBe(toHex(publicHashes.eip712DomainLo, { size: 32 }));
    expect(actual.eip712DomainHi).toBe(toHex(publicHashes.eip712DomainHi, { size: 32 }));
    expect(actual.signerRoot).toBe(toHex(signerTree.root, { size: 32 }));
    expect(actual.returnedHashedMessageHi).toBe(toHex(hashedMessageWords.hi, { size: 32 }));
    expect(actual.returnedHashedMessageLo).toBe(toHex(hashedMessageWords.lo, { size: 32 }));
    expect(actual.returnedDelegationHashHi).toBe(toHex(delegationHashWords.hi, { size: 32 }));
    expect(actual.returnedDelegationHashLo).toBe(toHex(delegationHashWords.lo, { size: 32 }));
    expect(actual.signerCommitment).toBe(toHex(expectedSignerCommitment, { size: 32 }));
    expect(actual.signerNullifier).toBe(toHex(expectedSignerNullifier, { size: 32 }));
  }, { timeout: 20000 });
});
