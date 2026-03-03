import { describe, it, expect } from "bun:test";
import { getMerkleTree } from "../src/merkle";
import { getConfidentialCommitment, getConfidentialNullifier, getConfidentialOutputContext } from "../src/joinsplits";
import { Prover } from "../src/prover";
import { TransferType, type ConfidentialInputNote, type ConfidentialOutputNote } from "../src/types";
import { toHex } from "viem";

const MERKLE_TREE_DEPTH = 20;

function extractPublicInputs(result: string[], inputLength: number, outputLength: number) {
  return {
    root: result[0]!,
    from: result[1]!,
    to: result[2]!,
    token: result[3]!,
    inputNullifiers: result.slice(4, 4 + inputLength),
    outputConfidentialContexts: result.slice(4 + inputLength, 4 + inputLength + outputLength),
  };
}

describe("confidential_utxo", () => {
  const from = 0xABCDn;
  const to = 0x1234n;
  const token = 1n;
  const tokenId = 0n;
  const treeId = 42n;

  it("should get 2x2 confidential proof", async () => {
    const notes: ConfidentialInputNote[] = [
      { tree_id: treeId, secret: 111n, amount: BigInt(100e18), leaf_index: 0n, leaf_path: [] },
      { tree_id: treeId, secret: 222n, amount: BigInt(100e18), leaf_index: 0n, leaf_path: [] },
    ];

    const commitments = notes.map((note) =>
      getConfidentialCommitment(from, to, treeId, token, tokenId, note)
    );

    const tree = getMerkleTree(commitments);

    const inputNotes: ConfidentialInputNote[] = notes.map((note, i) => {
      const proof = tree.generateProof(i);
      return {
        ...note,
        leaf_index: BigInt(proof.index),
        leaf_path: proof.siblings,
      };
    });

    const outputNotes: ConfidentialOutputNote[] = [
      { wormhole_recipient: null, amount: BigInt(150e18), secret: 333n, transfer_type: TransferType.TRANSFER },
      { wormhole_recipient: null, amount: BigInt(50e18), secret: 444n, transfer_type: TransferType.TRANSFER },
    ];

    const circuitInputs = {
      root: tree.root.toString(),
      from: from.toString(),
      to: to.toString(),
      token: token.toString(),
      token_id: tokenId.toString(),
      input_notes: inputNotes.map((note) => ({
        tree_id: note.tree_id.toString(),
        secret: note.secret.toString(),
        amount: note.amount.toString(),
        leaf_index: note.leaf_index.toString(),
        leaf_path: note.leaf_path
          .map((s) => s.toString())
          .concat(Array(MERKLE_TREE_DEPTH - note.leaf_path.length).fill("0")),
      })),
      output_notes: outputNotes.map((note) => ({
        wormhole_recipient: {
          _is_some: note.wormhole_recipient !== null,
          _value: (note.wormhole_recipient ?? 0n).toString(),
        },
        amount: note.amount.toString(),
        secret: note.secret.toString(),
        transfer_type: note.transfer_type,
      })),
    };

    const prover = new Prover("confidential_utxo_2x2");

    console.time("prove");
    const result = await prover.prove(circuitInputs);
    console.timeEnd("prove");

    console.time("verify");
    const isValid = await prover.verify(result);
    console.timeEnd("verify");
    expect(isValid).toBe(true);

    const expectedNullifiers = inputNotes.map((note) =>
      getConfidentialNullifier(from, to, token, tokenId, note)
    );
    const expectedContexts = outputNotes.map((note) =>
      getConfidentialOutputContext(token, tokenId, note)
    );

    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, outputNotes.length);

    expect(actual.root, "root public input mismatch").toBe(toHex(tree.root, { size: 32 }));
    expect(actual.from, "from public input mismatch").toBe(toHex(from, { size: 32 }));
    expect(actual.to, "to public input mismatch").toBe(toHex(to, { size: 32 }));
    expect(actual.token, "token public input mismatch").toBe(toHex(token, { size: 32 }));
    expect(actual.inputNullifiers, "input nullifiers mismatch").toEqual(
      expectedNullifiers.map((n) => toHex(n, { size: 32 }))
    );
    expect(actual.outputConfidentialContexts, "output confidential contexts mismatch").toEqual(
      expectedContexts.map((c) => toHex(c, { size: 32 }))
    );
  }, { timeout: 10000 });

  it("should get 2x2 confidential proof with one zero input", async () => {
    const note: ConfidentialInputNote = {
      tree_id: treeId,
      secret: 555n,
      amount: BigInt(200e18),
      leaf_index: 0n,
      leaf_path: [],
    };

    const commitment = getConfidentialCommitment(from, to, treeId, token, tokenId, note);
    const tree = getMerkleTree([commitment]);
    const proof = tree.generateProof(0);

    const inputNotes: ConfidentialInputNote[] = [
      { ...note, leaf_index: BigInt(proof.index), leaf_path: proof.siblings },
      { tree_id: treeId, secret: 0n, amount: 0n, leaf_index: 0n, leaf_path: [] },
    ];

    const outputNotes: ConfidentialOutputNote[] = [
      { wormhole_recipient: null, amount: BigInt(200e18), secret: 666n, transfer_type: TransferType.TRANSFER },
      { wormhole_recipient: null, amount: 0n, secret: 777n, transfer_type: TransferType.TRANSFER },
    ];

    const circuitInputs = {
      root: tree.root.toString(),
      from: from.toString(),
      to: to.toString(),
      token: token.toString(),
      token_id: tokenId.toString(),
      input_notes: inputNotes.map((note) => ({
        tree_id: note.tree_id.toString(),
        secret: note.secret.toString(),
        amount: note.amount.toString(),
        leaf_index: note.leaf_index.toString(),
        leaf_path: note.leaf_path
          .map((s) => s.toString())
          .concat(Array(MERKLE_TREE_DEPTH - note.leaf_path.length).fill("0")),
      })),
      output_notes: outputNotes.map((note) => ({
        wormhole_recipient: {
          _is_some: note.wormhole_recipient !== null,
          _value: (note.wormhole_recipient ?? 0n).toString(),
        },
        amount: note.amount.toString(),
        secret: note.secret.toString(),
        transfer_type: note.transfer_type,
      })),
    };

    const prover = new Prover("confidential_utxo_2x2");

    console.time("prove");
    const result = await prover.prove(circuitInputs);
    console.timeEnd("prove");

    console.time("verify");
    const isValid = await prover.verify(result);
    console.timeEnd("verify");
    expect(isValid).toBe(true);

    const expectedNullifiers = inputNotes.map((note) =>
      getConfidentialNullifier(from, to, token, tokenId, note)
    );
    const expectedContexts = outputNotes.map((note) =>
      getConfidentialOutputContext(token, tokenId, note)
    );

    const actual = extractPublicInputs(result.publicInputs, inputNotes.length, outputNotes.length);

    expect(actual.inputNullifiers, "input nullifiers mismatch").toEqual(
      expectedNullifiers.map((n) => toHex(n, { size: 32 }))
    );
    expect(actual.outputConfidentialContexts, "output confidential contexts mismatch").toEqual(
      expectedContexts.map((c) => toHex(c, { size: 32 }))
    );
  }, { timeout: 10000 });
});
