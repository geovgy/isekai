import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, Bytes, BigInt } from "@graphprotocol/graph-ts"
import { VerifierAdded } from "../generated/schema"
import { VerifierAdded as VerifierAddedEvent } from "../generated/ShieldedPool/ShieldedPool"
import { handleVerifierAdded } from "../src/shielded-pool"
import { createVerifierAddedEvent } from "./shielded-pool-utils"

describe("ShieldedPool entity assertions", () => {
  beforeAll(() => {
    let newVerifierAddedEvent = createVerifierAddedEvent(
      Address.fromString("0x0000000000000000000000000000000000000001"),
      BigInt.fromI32(2),
      BigInt.fromI32(2)
    )
    handleVerifierAdded(newVerifierAddedEvent)
  })

  afterAll(() => {
    clearStore()
  })

  test("VerifierAdded created and stored", () => {
    assert.entityCount("VerifierAdded", 1)
  })
})
