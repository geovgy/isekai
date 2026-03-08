import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js"
import { Barretenberg, ProofData, UltraHonkBackend } from "@aztec/bb.js"

// Static imports for circuits - these get bundled by webpack
import ragequitCircuit from "@/artifacts/circuits/ragequit.json"
import batchDelegatedUtxo2x2Circuit from "@/artifacts/circuits/batch_delegated_utxo_2x2.json"
import delegatedUtxo2x2Circuit from "@/artifacts/circuits/delegated_utxo_2x2.json"
import utxo2x2Circuit from "@/artifacts/circuits/utxo_2x2.json"

export type CircuitType = "utxo_2x2" | "delegated_utxo_2x2" | "batch_delegated_utxo_2x2" | "ragequit";

const circuits: Record<CircuitType, CompiledCircuit> = {
  batch_delegated_utxo_2x2: batchDelegatedUtxo2x2Circuit as unknown as CompiledCircuit,
  delegated_utxo_2x2: delegatedUtxo2x2Circuit as unknown as CompiledCircuit,
  ragequit: ragequitCircuit as unknown as CompiledCircuit,
  utxo_2x2: utxo2x2Circuit as unknown as CompiledCircuit,
}

function getCircuit(type: CircuitType): CompiledCircuit {
  return circuits[type];
}

export class ZKProver {
  private _backend: UltraHonkBackend | undefined
  private _circuitType: CircuitType
  private _noir: Noir | undefined

  private _initialized = false

  constructor(circuit: CircuitType) {
    this._circuitType = circuit
  }

  get backend() {
    if (!this._backend) {
      throw new Error("ZKProver not initialized")
    }
    return this._backend
  }

  get noir() {
    if (!this._noir) {
      throw new Error("ZKProver not initialized")
    }
    return this._noir
  }

  async init() {
    if (this._initialized) return
    const circuit = getCircuit(this._circuitType)
    this._noir = new Noir(circuit)
    const api = await Barretenberg.new()
    this._backend = new UltraHonkBackend(circuit.bytecode, api)
    this._initialized = true
  }

  async prove(inputs: InputMap, options: { keccak: boolean } = { keccak: true }) {
    await this.init()
    const { witness } = await this.noir.execute(inputs)
    return await this.backend.generateProof(witness, options)
  }

  async verify(proof: ProofData, options: { keccak: boolean } = { keccak: true }) {
    await this.init()
    return await this.backend.verifyProof(proof, options)
  }

  async getVerificationKey(options: { keccak: boolean } = { keccak: true }) {
    await this.init()
    return await this.backend.getVerificationKey(options)
  }

  async getSolidityVerifier(options: { keccak: boolean } = { keccak: true }) {
    const vk = await this.getVerificationKey(options)
    return await this.backend.getSolidityVerifier(vk, options)
  }
}

export function extractUTXOPublicInputs(result: string[], inputLength: number, outputLength: number) {
  return {
    hashedMessage: result[0]!,
    shieldedRoot: result[1]!,
    wormholeRoot: result[2]!,
    wormholeNullifier: result[3]!,
    inputNullifiers: result.slice(4, 4 + inputLength),
    outputCommitments: result.slice(4 + inputLength, 4 + inputLength + outputLength),
  }
}