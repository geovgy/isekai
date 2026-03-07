import { Prover, type CircuitType } from "../src/prover"
import { writeFileSync } from "fs"
import path from "path"

const CIRCUITS: CircuitType[] = ["utxo_2x2", "ragequit", "delegated_utxo_2x2", "confidential_utxo_2x2", "batch_delegated_utxo_2x2"]

async function generateAndWriteSolidityVerifierFor(circuit: CircuitType) {
  const prover = new Prover(circuit)
  const solidityVerifier = await prover.getSolidityVerifier({ keccak: true })
  const verifierPath = path.join(__dirname, "../circuits/main/", circuit, "target", circuit + "_verifier.sol")
  writeFileSync(verifierPath, solidityVerifier)
}

async function main() {
  console.log(`Generating solidity verifiers for ${CIRCUITS.length} circuits:`)
  for (const circuit of CIRCUITS) {
    console.log(`- ${circuit}`)
    await generateAndWriteSolidityVerifierFor(circuit)
  }
  console.log("Done")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })