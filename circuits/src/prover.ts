import { Noir, type InputMap, type CompiledCircuit } from "@noir-lang/noir_js";
import { Barretenberg, type ProofData, UltraHonkBackend, type VerifierTarget } from "@aztec/bb.js";

export type CircuitType = "utxo_2x2" | "delegated_utxo_2x2" | "confidential_utxo_2x2" | "ragequit" | "batch_delegated_utxo_2x2" | "batch_delegated_utxo_2x2_recursive" | "revoke_delegation";

function getCircuitPath(type: CircuitType): string {
  return `../circuits/main/${type}/target/${type}.json`;
}

async function getCircuit(type: CircuitType): Promise<CompiledCircuit> {
  const importPath = getCircuitPath(type);
  const circuit = await import(importPath);
  return circuit as CompiledCircuit;
}


export class Prover {
  private _backend: UltraHonkBackend | undefined
  private _circuitType: CircuitType
  private _noir: Noir | undefined

  private _initialized = false

  constructor(circuit: CircuitType) {
    this._circuitType = circuit
  }

  get backend() {
    if (!this._backend) {
      throw new Error("Prover not initialized")
    }
    return this._backend
  }

  get noir() {
    if (!this._noir) {
      throw new Error("Prover not initialized")
    }
    return this._noir
  }

  async init() {
    if (this._initialized) return
    const circuit = await getCircuit(this._circuitType)
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