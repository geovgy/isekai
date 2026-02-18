import { Abi, Address, bytesToBigInt, erc20Abi, erc721Abi, getAddress, hashTypedData, Hex, hexToBytes, isAddressEqual, parseEventLogs, recoverPublicKey, toHex, TransactionReceipt, TypedData } from "viem"
import { publicKeyToAddress } from "viem/accounts"
import { NoteDB } from "@/src/storage/notes-db"
import { InputNote, NoteDBShieldedEntry, NoteDBWormholeEntry, OutputNote, ShieldedTx, TransferType, Withdrawal, WormholeDeposit } from "@/src/types"
import { createShieldedTransferOutputNotes, getShieldedTransferInputEntries } from "./utils"
import { getMerkleTrees, queryTrees } from "@/src/subgraph-queries"
import { getMerkleTree } from "@/src/merkle"
import { getAssetId, getCommitment, getNullifier, getRandomBlinding, getWormholeBurnAddress, getWormholeNullifier, getWormholePseudoNullifier } from "@/src/joinsplits"
import { signTypedData, writeContract } from "wagmi/actions"
import { Config } from "wagmi"
import { SHIELDED_POOL_CONTRACT_ADDRESS } from "../env"
import { getChainConfig, MASTER_CHAIN_ID } from "../config"
import { MERKLE_TREE_DEPTH } from "../constants"
import { InputMap } from "@noir-lang/noir_js"

const wormholeEntryEventAbi = [{
  type: "event",
  name: "WormholeEntry",
  inputs: [
    { name: "entryId", type: "uint256", indexed: true },
    { name: "token", type: "address", indexed: true },
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: false },
    { name: "id", type: "uint256", indexed: false },
    { name: "amount", type: "uint256", indexed: false },
  ],
}] as const

const shieldedTransferEventAbi = [{
  type: "event",
  name: "ShieldedTransfer",
  inputs: [
    { name: "treeId", type: "uint256", indexed: true },
    { name: "startIndex", type: "uint256", indexed: false },
    { name: "commitments", type: "uint256[]", indexed: false },
    { name: "nullifiers", type: "bytes32[]", indexed: false },
    { name: "withdrawals", type: "tuple[]", indexed: false, components: [
      { name: "to", type: "address" },
      { name: "asset", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
    ] },
  ],
}] as const

export class ShieldedPool {
  private _db: NoteDB;
  account: Address;

  constructor(account: Address) {
    this._db = new NoteDB(account);
    this.account = account;
  }

  async wormholeTransfer(config: Config, {
    to,
    tokenType,
    token,
    tokenId,
    amount,
  }: {
    to: Address,
    tokenType?: "erc20",
    token: Address,
    tokenId?: bigint,
    amount: bigint,
  }) {
    // const client = config.getClient()
    // if (!client) {
    //   throw new Error("Client not found");
    // }
    // console.log({
    //   clientAccount: client.account?.address,
    //   thisAccount: this.account,
    // })
    // if (!client.account?.address || !isAddressEqual(client.account.address, this.account)) {
    //   throw new Error("Account missing or mismatch");
    // }

    const wormholeSecret = getRandomBlinding();
    const burnAddress = getWormholeBurnAddress(to, wormholeSecret);

    // TODO: Check token type and use the appropriate ABI
    const tokenAbi = erc20Abi;

    const hash = await writeContract(config, {
      address: token,
      abi: tokenAbi,
      functionName: "transfer",
      args: [burnAddress, amount],
    })

    return {
      hash,
      wormholeSecret,
      burnAddress,
    }
  }

  async parseAndSaveWormholeEntry(args: {
    chainId: number,
    destinationChainId?: number,
    receiver: Address,
    wormholeSecret: bigint,
    receipt: TransactionReceipt,
  }) {
    const { entryId, token, from, to, id, amount } = this.parseWormholeEntryLogFromReceipt(args.receipt)
    const wormholeEntry: NoteDBWormholeEntry = {
      id: entryId.toString(),
      entryId: entryId.toString(),
      treeNumber: 0,
      leafIndex: 0,
      chainId: args.chainId,
      destinationChainId: args.destinationChainId,
      entry: {
        to: args.receiver,
        from,
        wormhole_secret: args.wormholeSecret.toString(),
        token,
        token_id: id.toString(),
        amount: amount.toString(),
      },
      status: "pending",
      blockNumber: Number(args.receipt.blockNumber),
      blockTimestamp: Math.floor(Date.now() / 1000),
      masterTreeStatus: args.chainId === MASTER_CHAIN_ID ? "included" : "pending",
    }
    await this._db.checkAndAddNote("wormhole_note", wormholeEntry)
    return wormholeEntry
  }

  parseWormholeEntryLogFromReceipt(receipt: TransactionReceipt) {
    const parsedLogs = parseEventLogs({
      abi: wormholeEntryEventAbi,
      eventName: "WormholeEntry",
      logs: receipt.logs,
    })
    if (parsedLogs.length === 0) {
      throw new Error("WormholeEntry log not found in receipt");
    }
    return parsedLogs[0].args
  }

  async getWormholeNotes() {
    return this._db.getWormholeNotes()
  }

  async getShieldedNotes() {
    return this._db.getShieldedNotes()
  }

  async updateNote(store: "wormhole_note" | "shielded_note", note: NoteDBShieldedEntry | NoteDBWormholeEntry) {
    return this._db.updateNote(store, note)
  }

  async getShieldedBalance(args: {
    token: Address,
    tokenId?: bigint,
    excludeWormholes?: boolean
  }) {
    const shieldedNotes = (await this.getShieldedNotes()).filter(note => (
      note.status === "available" 
      && isAddressEqual(note.note.account, this.account)
      && isAddressEqual(note.note.asset, args.token)
      && (args.tokenId ? BigInt(note.note.assetId ?? "0") === args.tokenId : true)
    ))
    const balance = shieldedNotes.reduce((total, note) => total + BigInt(note.note.amount ?? "0"), BigInt(0))
    if (args.excludeWormholes) {
      return balance;
    }
    const wormholeNotes = (await this.getWormholeNotes()).filter(note => (
      note.status === "approved" && !note.usedAt
      && isAddressEqual(note.entry.to, this.account)
      && isAddressEqual(note.entry.token, args.token)
      && (args.tokenId ? BigInt(note.entry.token_id ?? "0") === args.tokenId : true)
    ))
    return balance + wormholeNotes.reduce((total, note) => {
      const amount = BigInt(note.entry.amount ?? "0")
      return total > amount ? total : amount;
    }, BigInt(0));
  }

  async updateWormholeEntryCommitment(entryId: string, update: {
    treeNumber: number,
    leafIndex: number,
    status: NoteDBWormholeEntry["status"],
  }) {
    const entry = await this._db.getNote("wormhole_note", entryId) as NoteDBWormholeEntry | undefined
    if (!entry) {
      throw new Error(`Wormhole entry with id ${entryId} not found in DB`)
    }
    const updated: NoteDBWormholeEntry = {
      ...entry,
      treeNumber: update.treeNumber,
      leafIndex: update.leafIndex,
      status: update.status,
    }
    await this._db.updateNote("wormhole_note", updated)
    return updated
  }

  async parseAndSaveShieldedTransfer(args: {
    chainId: number,
    token: Address,
    tokenId?: bigint,
    receipt: TransactionReceipt,
    entries: {
      wormhole?: NoteDBWormholeEntry,
      shielded: NoteDBShieldedEntry[],
    },
    outputNotes: OutputNote[],
  }) {
    const now = Date.now().toString()

    // Parse ShieldedTransfer event
    const shieldedTransferLogs = parseEventLogs({
      abi: shieldedTransferEventAbi,
      eventName: "ShieldedTransfer",
      logs: args.receipt.logs,
    })
    if (shieldedTransferLogs.length === 0) {
      throw new Error("ShieldedTransfer log not found in receipt")
    }
    const { treeId, startIndex } = shieldedTransferLogs[0].args

    // Mark used shielded input entries as "used"
    for (const entry of args.entries.shielded) {
      const updated: NoteDBShieldedEntry = {
        ...entry,
        status: "used",
        usedAt: now,
      }
      await this._db.updateNote("shielded_note", updated)
    }

    // Mark used wormhole entry as "completed"
    if (args.entries.wormhole) {
      const updated: NoteDBWormholeEntry = {
        ...args.entries.wormhole,
        status: "completed",
        usedAt: now,
      }
      await this._db.updateNote("wormhole_note", updated)
    }

    // Save new output notes as shielded entries (skip withdrawals)
    const newEntries: NoteDBShieldedEntry[] = args.outputNotes
      .map((note, index) => ({ note, originalIndex: index }))
      .filter(({ note }) => note.transfer_type !== TransferType.WITHDRAWAL)
      .map(({ note, originalIndex }) => {
        const leafIndex = Number(startIndex) + originalIndex
        const recipient = typeof note.recipient === "bigint"
          ? toHex(note.recipient) as Address
          : note.recipient
        return {
          id: `${args.chainId}:${Number(treeId)}:${leafIndex}`,
          treeNumber: Number(treeId),
          leafIndex,
          chainId: args.chainId,
          from: this.account,
          note: {
            account: recipient,
            asset: args.token,
            assetId: args.tokenId?.toString(),
            blinding: note.blinding.toString(),
            amount: note.amount.toString(),
            transferType: note.transfer_type,
          },
          status: "available" as const,
          committedAt: now,
          blockNumber: Number(args.receipt.blockNumber),
          blockTimestamp: Math.floor(Date.now() / 1000),
          masterTreeStatus: args.chainId === MASTER_CHAIN_ID ? "included" : "pending",
        }
      })

    await this._db.checkAndAddMultipleNotes("shielded_note", newEntries)

    return {
      treeId: Number(treeId),
      startIndex: Number(startIndex),
      newEntries,
    }
  }

  // TODO: Implement ragequit
  async ragequit(chainId: number, entryId: bigint) {
    throw new Error("Not implemented");
  }

  async signShieldedTransfer(config: Config, args: {
    chainId: number,
    receiver: Address,
    token: Address,
    tokenId?: bigint,
    amount: bigint,
    unshield?: boolean, // if true, will include a withdraw note of amount
  }) {
    const assetId = getAssetId(args.token, args.tokenId);
    const transferType = args.unshield ? TransferType.WITHDRAWAL : TransferType.TRANSFER;
    const { wormhole, shielded } = await getShieldedTransferInputEntries(this._db, { sender: this.account, ...args })
    const { wormholeTree, shieldedTree } = await getMerkleTrees({
      wormholeTreeId: BigInt(wormhole?.treeNumber ?? 0),
      shieldedTreeId: BigInt(shielded[0]?.treeNumber ?? 0),
      chainId: args.chainId,
    })

    console.log({
      wormhole: wormhole,
      shielded: shielded.map(s => s.note),
    })

    console.log({
      wormholeRoot: wormholeTree.root,
      shieldedRoot: shieldedTree.root,
      wormholeTreeId: wormhole?.treeNumber,
      shieldedTreeId: shielded[0]?.treeNumber,
      wormholeLeaves: wormholeTree.leaves,
      shieldedLeaves: shieldedTree.leaves,
      size: shieldedTree.size,
      leafIndex: wormhole?.leafIndex,
    });
    let wormholeDeposit: WormholeDeposit | undefined = undefined;
    let wormholePseudoSecret: bigint | undefined = undefined;
    if (wormhole) {
      const wormholeProof = wormholeTree.generateProof(wormhole.leafIndex);
      wormholeDeposit = {
        recipient: wormhole.entry.to,
        wormhole_secret: BigInt(wormhole.entry.wormhole_secret),
        asset_id: assetId,
        sender: wormhole.entry.from,
        amount: BigInt(wormhole.entry.amount),
        leaf_index: BigInt(wormholeProof.index),
        leaf_siblings: wormholeProof.siblings,
        is_approved: wormhole.status === "approved",
      };
    } else {
      wormholePseudoSecret = getRandomBlinding();
    }
    const inputNotes: InputNote[] = shielded.map(input => {
      const proof = shieldedTree.generateProof(input.leafIndex)
      return {
        blinding: BigInt(input.note.blinding),
        amount: BigInt(input.note.amount),
        leaf_index: BigInt(proof.index),
        leaf_siblings: proof.siblings,
      }
    }).concat(Array.from({ length: 2 - shielded.length }).map(() => ({ // TODO: Use more efficient way to generate dummy notes
      blinding: getRandomBlinding(),
      amount: BigInt(0),
      leaf_index: BigInt(0),
      leaf_siblings: Array(MERKLE_TREE_DEPTH).fill(BigInt(0)),
    })));
    const outputNotes = createShieldedTransferOutputNotes({
      sender: this.account, 
      receiver: args.receiver, 
      amount: args.amount, 
      transferType, 
      notes: { shielded, wormhole }
    })

    const shieldedTxStruct = toShieldedTxStruct({
      chainId: BigInt(args.chainId),
      sender: this.account,
      token: args.token,
      tokenId: args.tokenId,
      shieldedRoot: shieldedTree.root ?? 0n,
      wormholeRoot: wormholeTree.root ?? 0n,
      wormholeDeposit,
      wormholePseudoSecret,
      inputs: inputNotes,
      outputs: outputNotes,
    })

    const typedData = {
      domain: {
        name: "ShieldedPool",
        version: "1",
        chainId: args.chainId,
        verifyingContract: getAddress(getChainConfig(args.chainId).contractAddress),
      },
      types: {
        ShieldedTx: [
          { name: "chainId", type: "uint64" },
          { name: "wormholeRoot", type: "bytes32" },
          { name: "wormholeNullifier", type: "bytes32" },
          { name: "shieldedRoot", type: "bytes32" },
          { name: "nullifiers", type: "bytes32[]" },
          { name: "commitments", type: "uint256[]" },
          { name: "withdrawals", type: "Withdrawal[]" },
        ],
        Withdrawal: [
          { name: "to", type: "address" },
          { name: "asset", type: "address" },
          { name: "id", type: "uint256" },
          { name: "amount", type: "uint256" },
        ],
      },
      message: shieldedTxStruct,
      primaryType: "ShieldedTx",
    }

    const signature = await signTypedData(config, typedData as any)
    let messageHash = hashTypedData(typedData as any)
    const publicKey = await recoverPublicKey({hash: messageHash, signature})

    // Verify the recovered address matches the expected signer
    const recoveredAddress = publicKeyToAddress(publicKey)
    if (!isAddressEqual(recoveredAddress, this.account)) {
      console.error("Address mismatch after ecrecover", {
        recoveredAddress,
        expectedAddress: this.account,
        messageHash,
        signature,
        publicKey,
      })
      throw new Error(`Recovered signer ${recoveredAddress} does not match expected account ${this.account}. The wallet's EIP-712 hash may differ from the client-computed hash.`)
    }

    const circuitInputs: InputMap = {
      pub_key_x: [...hexToBytes(publicKey).slice(1, 33)],
      pub_key_y: [...hexToBytes(publicKey).slice(33, 65)],
      signature: [...hexToBytes(signature).slice(0, 64)], // Remove recovery byte (v)
      hashed_message: [...hexToBytes(messageHash)],
      shielded_root: toHex(shieldedTree.root ?? 0n, { size: 32 }),
      wormhole_root: toHex(wormholeTree.root ?? 0n, { size: 32 }),
      asset_id: assetId.toString(),
      owner_address: BigInt(this.account).toString(),
      input_notes: inputNotes.map(note => ({
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        leaf_index: note.leaf_index.toString(),
        leaf_siblings: note.leaf_siblings.map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - note.leaf_siblings.length).fill("0")),
      })),
      output_notes: outputNotes.map(note => ({
        recipient: note.recipient.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        transfer_type: note.transfer_type,
      })),
      wormhole_note: {
        _is_some: !!wormholeDeposit,
        _value: {
          recipient: wormholeDeposit?.recipient ?? "0",
          wormhole_secret: wormholeDeposit?.wormhole_secret?.toString() ?? "0",
          asset_id: wormholeDeposit?.asset_id?.toString() ?? "0",
          sender: wormholeDeposit?.sender ?? "0x00",
          amount: wormholeDeposit?.amount?.toString() ?? "0",
        }
      },
      wormhole_leaf_index: {
        _is_some: !!wormholeDeposit,
        _value: wormholeDeposit?.leaf_index?.toString() ?? "0",
      },
      wormhole_leaf_siblings: {
        _is_some: !!wormholeDeposit,
        _value: (wormholeDeposit?.leaf_siblings ?? []).map(sibling => sibling.toString()).concat(Array(MERKLE_TREE_DEPTH - (wormholeDeposit?.leaf_siblings?.length ?? 0)).fill("0")),
      },
      wormhole_approved: {
        _is_some: !!wormholeDeposit,
        _value: wormholeDeposit?.is_approved ?? false,
      },
      wormhole_pseudo_secret: {
        _is_some: !wormholeDeposit,
        _value: wormholePseudoSecret?.toString() ?? "0",
      },
    }

    return {
      typedData,
      wormholeDeposit,
      inputNotes,
      outputNotes,
      entries: { wormhole, shielded },
      wormholeTree, 
      shieldedTree,
      circuitInputs,
      messageHash,
      signature,
      publicKey,
      wormholePseudoSecret,
    }
  }
}


export function toShieldedTxStruct(args: {
  chainId: bigint,
  sender: Address, // required if wormholeDeposit is undefined
  token: Address, // only for unshields
  tokenId?: bigint, // only for unshields (optional: defaults to 0)
  shieldedRoot: bigint,
  wormholeRoot: bigint,
  wormholeDeposit?: WormholeDeposit,
  wormholePseudoSecret?: bigint, // required if wormholeDeposit is undefined
  inputs: InputNote[],
  outputs: OutputNote[],
}): ShieldedTx {
  const assetId = getAssetId(args.token, args.tokenId);
  const isUnshield = args.outputs.some(output => output.transfer_type === TransferType.WITHDRAWAL);
  
  let wormholeNullifier: Hex;
  let withdrawals: Withdrawal[] = [];

  if (args.wormholeDeposit) {
    wormholeNullifier = toHex(getWormholeNullifier(args.wormholeDeposit), { size: 32 });
  } else {
    if (!args.wormholePseudoSecret) {
      throw new Error("wormholePseudoSecret is required");
    }
    if (!args.sender) {
      throw new Error("sender is required");
    }
    if (!args.token) {
      throw new Error("token is required");
    }
    const assetId = getAssetId(args.token, args.tokenId);
    wormholeNullifier = toHex(getWormholePseudoNullifier(args.sender, assetId, args.wormholePseudoSecret), { size: 32 });
  }

  if (isUnshield) {
    if (!args.token) {
      throw new Error("token is required for unshields");
    }
    withdrawals = args.outputs
      .filter(output => output.transfer_type === TransferType.WITHDRAWAL)
      .map(output => {
        const to = typeof output.recipient === "bigint" ? toHex(output.recipient) : output.recipient;
        return {
          to,
          asset: args.token as Address,
          id: args.tokenId ?? 0n,
          amount: output.amount,
        }
      });
  }

  return {
    chainId: args.chainId,
    wormholeRoot: toHex(args.wormholeRoot, { size: 32 }),
    wormholeNullifier,
    shieldedRoot: toHex(args.shieldedRoot, { size: 32 }),
    nullifiers: args.inputs.map(input => toHex(getNullifier(args.sender, assetId, input), { size: 32 })),
    commitments: args.outputs.filter(output => output.transfer_type === TransferType.TRANSFER).map(output => getCommitment(assetId, output)),
    withdrawals,
  }
}