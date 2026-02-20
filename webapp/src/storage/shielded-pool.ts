import { Abi, Address, bytesToBigInt, erc20Abi, erc721Abi, getAddress, hashTypedData, Hex, hexToBytes, isAddressEqual, parseEventLogs, recoverPublicKey, toHex, TransactionReceipt, TypedData } from "viem"
import { publicKeyToAddress } from "viem/accounts"
import { NoteDB } from "@/src/storage/notes-db"
import { InputNote, NoteDBShieldedEntry, NoteDBWormholeEntry, OutputNote, ShieldedTx, TransferType, Withdrawal, WormholeDeposit } from "@/src/types"
import { createShieldedTransferOutputNotes, getShieldedTransferInputEntries } from "./utils"
import {
  queryLatestMasterTreesUpdatedOnChain,
  queryBranchShieldedTreeSnapshot,
  queryBranchWormholeTreeSnapshot,
  queryMasterShieldedTreeSnapshot,
  queryMasterWormholeTreeSnapshot,
  queryMasterShieldedTreeLeavesForBranchChain,
  queryMasterWormholeTreeLeavesForBranchChain,
  queryMasterTreesUpdatedWithinBlockRange,
} from "@/src/subgraph-queries"
import { getMerkleTree } from "@/src/merkle"
import { getAssetId, getCommitment, getNullifier, getRandomBlinding, getWormholeBurnAddress, getWormholeNullifier, getWormholePseudoNullifier } from "@/src/joinsplits"
import { signTypedData, writeContract } from "wagmi/actions"
import { Config } from "wagmi"
import { SHIELDED_POOL_CONTRACT_ADDRESS } from "../env"
import { getChainConfig, MASTER_CHAIN_ID, SUPPORTED_CHAIN_IDS } from "../config"
import { MERKLE_TREE_DEPTH } from "../constants"
import { InputMap } from "@noir-lang/noir_js"
import { LeanIMT } from "@zk-kit/lean-imt"

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
    chainId,
    to,
    tokenType,
    token,
    tokenId,
    amount,
  }: {
    chainId: number,
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
    if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }
    const burnAddress = getWormholeBurnAddress(BigInt(chainId), to, wormholeSecret);

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
    srcChainId: number,
    dstChainId: number,
    receiver: Address,
    wormholeSecret: bigint,
    receipt: TransactionReceipt,
  }) {
    const { entryId, token, from, to, id, amount } = this.parseWormholeEntryLogFromReceipt(args.receipt)
    const wormholeEntry: NoteDBWormholeEntry = {
      id: `${args.srcChainId}:${entryId}`,
      entryId: entryId.toString(),
      treeNumber: 0,
      leafIndex: 0,
      srcChainId: args.srcChainId,
      dstChainId: args.dstChainId,
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
      masterTreeStatus: args.srcChainId === MASTER_CHAIN_ID ? "included" : "pending",
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

  async patchNote<T extends NoteDBShieldedEntry | NoteDBWormholeEntry>(
    store: "wormhole_note" | "shielded_note",
    id: string,
    patchFn: (current: T) => Partial<T> | null,
  ) {
    return this._db.patchNote<T>(store, id, patchFn)
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

  async updateWormholeEntryCommitment(chainId: number, entryId: string, update: {
    treeNumber: number,
    leafIndex: number,
    status: NoteDBWormholeEntry["status"],
  }) {
    const id = `${chainId}:${entryId}`
    const result = await this._db.patchNote<NoteDBWormholeEntry>("wormhole_note", id, (current) => {
      if (current.status !== "pending") return null;
      return {
        treeNumber: update.treeNumber,
        leafIndex: update.leafIndex,
        status: update.status,
      };
    });
    if (!result) {
      throw new Error(`Wormhole entry with id ${id} not found or already updated`)
    }
    return result
  }

  async parseAndSaveShieldedTransfer(args: {
    srcChainId: number,
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
          id: `${args.srcChainId}:${Number(treeId)}:${leafIndex}`,
          treeNumber: Number(treeId),
          leafIndex,
          srcChainId: args.srcChainId,
          dstChainId: Number(note.chain_id),
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
          masterTreeStatus: args.srcChainId === MASTER_CHAIN_ID ? "included" : "pending",
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
    srcChainId: number,
    dstChainId: number,
    receiver: Address,
    token: Address,
    tokenId?: bigint,
    amount: bigint,
    unshield?: boolean, // if true, will include a withdraw note of amount
  }) {
    const assetId = getAssetId(args.token, args.tokenId);
    const transferType = args.unshield ? TransferType.WITHDRAWAL : TransferType.TRANSFER;
    const { wormhole, shielded } = await getShieldedTransferInputEntries(this._db, { chainId: args.srcChainId, sender: this.account, receiver: args.receiver, token: args.token, tokenId: args.tokenId, amount: args.amount })
    
    const latestMasterUpdate = await queryLatestMasterTreesUpdatedOnChain(args.srcChainId)
    if (!latestMasterUpdate) {
      throw new Error(`No master tree update found on chain ${args.srcChainId}. Wait for the master tree to sync.`)
    }
    const masterBlockNumber = Number(latestMasterUpdate.masterBlockNumber)

    let shieldedTree: LeanIMT<bigint>
    let masterShieldedProof: ReturnType<LeanIMT<bigint>['generateProof']>
    let shieldedMasterTree: LeanIMT<bigint>

    if (shielded.length > 0) {
      const noteSrcChainId = shielded[0].srcChainId
      const treeNumber = shielded[0].treeNumber
      const noteBlockNumber = shielded[0].blockNumber ?? 0
      const maxLeafIndex = Math.max(...shielded.map(s => s.leafIndex))

      if (noteSrcChainId === MASTER_CHAIN_ID) {
        const coveringRoots = await queryMasterShieldedTreeLeavesForBranchChain({
          branchChainId: MASTER_CHAIN_ID,
          branchBlockNumber_gte: noteBlockNumber
        })
        let selectedRoot: { branchRoot: string; treeId: string; blockNumber: string } | null = null
        let selectedSnapshot: { leaves: string[]; size: string } | null = null
        for (const root of coveringRoots) {
          const snapshot = await queryBranchShieldedTreeSnapshot({
            treeId: treeNumber,
            root: root.branchRoot,
            chainId: MASTER_CHAIN_ID
          })
          if (snapshot && snapshot.leaves.length > maxLeafIndex) {
            selectedRoot = root
            selectedSnapshot = snapshot
            break
          }
        }
        if (!selectedRoot || !selectedSnapshot) {
          throw new Error(`No branch shielded tree snapshot contains leaf index ${maxLeafIndex} for tree ${treeNumber} on master chain`)
        }
        shieldedTree = getMerkleTree(selectedSnapshot.leaves.map(l => BigInt(l)))

        const masterUpdates = await queryMasterTreesUpdatedWithinBlockRange({
          blockNumber_gte: Number(selectedRoot.blockNumber),
          blockNumber_lte: masterBlockNumber
        })
        if (masterUpdates.length === 0) {
          throw new Error(`No master tree update found after block ${selectedRoot.blockNumber} and within range ${masterBlockNumber}`)
        }
        const masterSnapshot = await queryMasterShieldedTreeSnapshot({
          treeId: Number(masterUpdates[0].masterShieldedTreeId),
          root: masterUpdates[0].masterShieldedRoot
        })
        if (!masterSnapshot) {
          throw new Error(`No master shielded tree snapshot found for root ${masterUpdates[0].masterShieldedRoot}`)
        }
        shieldedMasterTree = getMerkleTree(masterSnapshot.leaves.map(l => BigInt(l)))
        const branchRoot = BigInt(selectedRoot.branchRoot)
        const masterIndex = masterSnapshot.leaves.findIndex(l => BigInt(l) === branchRoot)
        if (masterIndex === -1) {
          throw new Error(`Branch shielded root not found in master tree`)
        }
        masterShieldedProof = shieldedMasterTree.generateProof(masterIndex)
      } else {
        const masterLeaves = await queryMasterShieldedTreeLeavesForBranchChain({
          branchChainId: noteSrcChainId,
          branchBlockNumber_gte: noteBlockNumber
        })
        const leafWithinMasterBlock = masterLeaves.find(l => Number(l.blockNumber) <= masterBlockNumber)
        if (!leafWithinMasterBlock) {
          throw new Error(`No master tree leaf found for shielded notes from chain ${noteSrcChainId} with block <= ${masterBlockNumber}`)
        }
        const branchSnapshot = await queryBranchShieldedTreeSnapshot({
          treeId: treeNumber,
          root: leafWithinMasterBlock.branchRoot,
          chainId: noteSrcChainId
        })
        if (!branchSnapshot || branchSnapshot.leaves.length <= maxLeafIndex) {
          throw new Error(`No branch shielded tree snapshot contains leaf index ${maxLeafIndex} for tree ${treeNumber} on chain ${noteSrcChainId}`)
        }
        shieldedTree = getMerkleTree(branchSnapshot.leaves.map(l => BigInt(l)))

        const masterUpdates = await queryMasterTreesUpdatedWithinBlockRange({
          blockNumber_gte: Number(leafWithinMasterBlock.blockNumber),
          blockNumber_lte: masterBlockNumber
        })
        if (masterUpdates.length === 0) {
          throw new Error(`No master tree update found after block ${leafWithinMasterBlock.blockNumber} and within range ${masterBlockNumber}`)
        }
        const masterSnapshot = await queryMasterShieldedTreeSnapshot({
          treeId: Number(masterUpdates[0].masterShieldedTreeId),
          root: masterUpdates[0].masterShieldedRoot
        })
        if (!masterSnapshot) {
          throw new Error(`No master shielded tree snapshot found for root ${masterUpdates[0].masterShieldedRoot}`)
        }
        shieldedMasterTree = getMerkleTree(masterSnapshot.leaves.map(l => BigInt(l)))
        const branchRoot = BigInt(leafWithinMasterBlock.branchRoot)
        const masterIndex = masterSnapshot.leaves.findIndex(l => BigInt(l) === branchRoot)
        if (masterIndex === -1) {
          throw new Error(`Branch shielded root not found in master tree`)
        }
        masterShieldedProof = shieldedMasterTree.generateProof(masterIndex)
      }
    } else {
      shieldedTree = getMerkleTree([0n])
      shieldedMasterTree = getMerkleTree([0n])
      masterShieldedProof = shieldedMasterTree.generateProof(0)
    }

    let wormholeTree: LeanIMT<bigint>
    let masterWormholeProof: ReturnType<LeanIMT<bigint>['generateProof']>
    let wormholeMasterTree: LeanIMT<bigint>

    if (wormhole) {
      const noteSrcChainId = wormhole.srcChainId
      const treeNumber = wormhole.treeNumber
      const noteBlockNumber = wormhole.blockNumber ?? 0
      const leafIndex = wormhole.leafIndex

      if (noteSrcChainId === MASTER_CHAIN_ID) {
        const coveringRoots = await queryMasterWormholeTreeLeavesForBranchChain({
          branchChainId: MASTER_CHAIN_ID,
          branchBlockNumber_gte: noteBlockNumber
        })
        let selectedRoot: { branchRoot: string; treeId: string; blockNumber: string } | null = null
        let selectedSnapshot: { leaves: string[]; size: string } | null = null
        for (const root of coveringRoots) {
          const snapshot = await queryBranchWormholeTreeSnapshot({
            treeId: treeNumber,
            root: root.branchRoot,
            chainId: MASTER_CHAIN_ID
          })
          if (snapshot && snapshot.leaves.length > leafIndex) {
            selectedRoot = root
            selectedSnapshot = snapshot
            break
          }
        }
        if (!selectedRoot || !selectedSnapshot) {
          throw new Error(`No branch wormhole tree snapshot contains leaf index ${leafIndex} for tree ${treeNumber} on master chain`)
        }
        wormholeTree = getMerkleTree(selectedSnapshot.leaves.map(l => BigInt(l)))

        const masterUpdates = await queryMasterTreesUpdatedWithinBlockRange({
          blockNumber_gte: Number(selectedRoot.blockNumber),
          blockNumber_lte: masterBlockNumber
        })
        if (masterUpdates.length === 0) {
          throw new Error(`No master tree update found after block ${selectedRoot.blockNumber} and within range ${masterBlockNumber}`)
        }
        const masterSnapshot = await queryMasterWormholeTreeSnapshot({
          treeId: Number(masterUpdates[0].masterWormholeTreeId),
          root: masterUpdates[0].masterWormholeRoot
        })
        if (!masterSnapshot) {
          throw new Error(`No master wormhole tree snapshot found for root ${masterUpdates[0].masterWormholeRoot}`)
        }
        wormholeMasterTree = getMerkleTree(masterSnapshot.leaves.map(l => BigInt(l)))
        const branchRoot = BigInt(selectedRoot.branchRoot)
        const masterIndex = masterSnapshot.leaves.findIndex(l => BigInt(l) === branchRoot)
        if (masterIndex === -1) {
          throw new Error(`Branch wormhole root not found in master tree`)
        }
        masterWormholeProof = wormholeMasterTree.generateProof(masterIndex)
      } else {
        const masterLeaves = await queryMasterWormholeTreeLeavesForBranchChain({
          branchChainId: noteSrcChainId,
          branchBlockNumber_gte: noteBlockNumber
        })
        const leafWithinMasterBlock = masterLeaves.find(l => Number(l.blockNumber) <= masterBlockNumber)
        if (!leafWithinMasterBlock) {
          throw new Error(`No master tree leaf found for wormhole notes from chain ${noteSrcChainId} with block <= ${masterBlockNumber}`)
        }
        const branchSnapshot = await queryBranchWormholeTreeSnapshot({
          treeId: treeNumber,
          root: leafWithinMasterBlock.branchRoot,
          chainId: noteSrcChainId
        })
        if (!branchSnapshot || branchSnapshot.leaves.length <= leafIndex) {
          throw new Error(`No branch wormhole tree snapshot contains leaf index ${leafIndex} for tree ${treeNumber} on chain ${noteSrcChainId}`)
        }
        wormholeTree = getMerkleTree(branchSnapshot.leaves.map(l => BigInt(l)))

        const masterUpdates = await queryMasterTreesUpdatedWithinBlockRange({
          blockNumber_gte: Number(leafWithinMasterBlock.blockNumber),
          blockNumber_lte: masterBlockNumber
        })
        if (masterUpdates.length === 0) {
          throw new Error(`No master tree update found after block ${leafWithinMasterBlock.blockNumber} and within range ${masterBlockNumber}`)
        }
        const masterSnapshot = await queryMasterWormholeTreeSnapshot({
          treeId: Number(masterUpdates[0].masterWormholeTreeId),
          root: masterUpdates[0].masterWormholeRoot
        })
        if (!masterSnapshot) {
          throw new Error(`No master wormhole tree snapshot found for root ${masterUpdates[0].masterWormholeRoot}`)
        }
        wormholeMasterTree = getMerkleTree(masterSnapshot.leaves.map(l => BigInt(l)))
        const branchRoot = BigInt(leafWithinMasterBlock.branchRoot)
        const masterIndex = masterSnapshot.leaves.findIndex(l => BigInt(l) === branchRoot)
        if (masterIndex === -1) {
          throw new Error(`Branch wormhole root not found in master tree`)
        }
        masterWormholeProof = wormholeMasterTree.generateProof(masterIndex)
      }
    } else {
      wormholeTree = getMerkleTree([0n])
      wormholeMasterTree = getMerkleTree([0n])
      masterWormholeProof = wormholeMasterTree.generateProof(0)
    }

    let wormholeDeposit: WormholeDeposit | undefined = undefined;
    let wormholePseudoSecret: bigint | undefined = undefined;
    if (wormhole) {
      const wormholeProof = wormholeTree.generateProof(wormhole.leafIndex);
      wormholeDeposit = {
        chain_id: BigInt(wormhole.dstChainId),
        entry_id: BigInt(wormhole.entryId),
        recipient: wormhole.entry.to,
        wormhole_secret: BigInt(wormhole.entry.wormhole_secret),
        asset_id: assetId,
        sender: wormhole.entry.from,
        amount: BigInt(wormhole.entry.amount),
        master_root: wormholeMasterTree.root,
        branch_root: wormholeTree.root,
        branch_index: BigInt(wormholeProof.index),
        branch_siblings: wormholeProof.siblings,
        master_index: BigInt(masterWormholeProof.index),
        master_siblings: masterWormholeProof.siblings,
        is_approved: wormhole.status === "approved",
      };
    } else {
      wormholePseudoSecret = getRandomBlinding();
    }
    
    const inputNotes: InputNote[] = shielded.map(input => {
      const proof = shieldedTree.generateProof(input.leafIndex)
      return {
        chain_id: BigInt(input.dstChainId),
        blinding: BigInt(input.note.blinding),
        amount: BigInt(input.note.amount),
        branch_index: BigInt(proof.index),
        branch_siblings: proof.siblings,
        branch_root: shieldedTree.root,
        master_index: BigInt(masterShieldedProof.index),
        master_siblings: masterShieldedProof.siblings,
      }
    }).concat(Array.from({ length: 2 - shielded.length }).map(() => ({
      chain_id: BigInt(args.srcChainId),
      blinding: 0n,
      amount: 0n,
      branch_index: 0n,
      branch_siblings: Array(MERKLE_TREE_DEPTH).fill(0n),
      branch_root: shieldedTree.root,
      master_index: BigInt(masterShieldedProof.index),
      master_siblings: masterShieldedProof.siblings,
    })));
    const outputNotes = createShieldedTransferOutputNotes({
      chainId: BigInt(args.dstChainId),
      sender: this.account, 
      receiver: args.receiver, 
      amount: args.amount, 
      transferType, 
      notes: { shielded, wormhole }
    })

    const shieldedTxStruct = toShieldedTxStruct({
      chainId: BigInt(args.srcChainId),
      sender: this.account,
      token: args.token,
      tokenId: args.tokenId,
      shieldedRoot: shieldedMasterTree.root ?? 0n,
      wormholeRoot: wormholeMasterTree.root ?? 0n,
      wormholeDeposit,
      wormholePseudoSecret,
      inputs: inputNotes,
      outputs: outputNotes,
    })

    const typedData = {
      domain: {
        name: "ShieldedPool",
        version: "1",
        chainId: args.srcChainId,
        verifyingContract: getAddress(getChainConfig(args.srcChainId).contractAddress),
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
      signature: [...hexToBytes(signature).slice(0, 64)],
      hashed_message: [...hexToBytes(messageHash)],
      chain_id: args.srcChainId.toString(),
      shielded_root: (shieldedMasterTree.root ?? 0n).toString(),
      wormhole_root: (wormholeMasterTree.root ?? 0n).toString(),
      asset_id: assetId.toString(),
      owner_address: this.account,
      input_notes: inputNotes.map(note => ({
        chain_id: note.chain_id.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        branch_index: note.branch_index.toString(),
        branch_siblings: note.branch_siblings.map(s => s.toString()).concat(Array(MERKLE_TREE_DEPTH - note.branch_siblings.length).fill("0")),
        branch_root: note.branch_root.toString(),
        master_index: note.master_index.toString(),
        master_siblings: note.master_siblings.map(s => s.toString()).concat(Array(MERKLE_TREE_DEPTH - note.master_siblings.length).fill("0")),
      })),
      output_notes: outputNotes.map(note => ({
        chain_id: note.chain_id.toString(),
        recipient: note.recipient.toString(),
        blinding: note.blinding.toString(),
        amount: note.amount.toString(),
        transfer_type: note.transfer_type,
      })),
      wormhole_note: {
        _is_some: !!wormholeDeposit,
        _value: {
          chain_id: wormholeDeposit?.chain_id?.toString() ?? "0",
          entry_id: wormholeDeposit?.entry_id?.toString() ?? "0",
          recipient: wormholeDeposit?.recipient?.toString() ?? "0",
          wormhole_secret: wormholeDeposit?.wormhole_secret?.toString() ?? "0",
          asset_id: wormholeDeposit?.asset_id?.toString() ?? "0",
          sender: wormholeDeposit?.sender?.toString() ?? "0",
          amount: wormholeDeposit?.amount?.toString() ?? "0",
          branch_index: wormholeDeposit?.branch_index?.toString() ?? "0",
          branch_siblings: (wormholeDeposit?.branch_siblings ?? []).map(s => s.toString()).concat(Array(MERKLE_TREE_DEPTH - (wormholeDeposit?.branch_siblings?.length ?? 0)).fill("0")),
          branch_root: wormholeDeposit?.branch_root?.toString() ?? "0",
          master_index: wormholeDeposit?.master_index?.toString() ?? "0",
          master_siblings: (wormholeDeposit?.master_siblings ?? []).map(s => s.toString()).concat(Array(MERKLE_TREE_DEPTH - (wormholeDeposit?.master_siblings?.length ?? 0)).fill("0")),
          is_approved: wormholeDeposit?.is_approved ?? false,
        },
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
      wormholeMasterTree,
      shieldedMasterTree,
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
    wormholeNullifier = toHex(getWormholePseudoNullifier(args.chainId, args.sender, assetId, args.wormholePseudoSecret), { size: 32 });
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
    nullifiers: args.inputs.map(input => toHex(getNullifier(args.chainId, input.branch_root, args.sender, assetId, input), { size: 32 })),
    commitments: args.outputs.filter(output => output.transfer_type === TransferType.TRANSFER).map(output => getCommitment(assetId, output)),
    withdrawals,
  }
}