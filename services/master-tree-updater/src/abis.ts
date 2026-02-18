import { parseAbi } from "viem"

export const updateMasterTreesAbi = parseAbi([
  "function updateMasterTrees(bytes calldata proof) external",
])

export const masterTreesUpdatedEventAbi = parseAbi([
  "event MasterTreesUpdated(uint256 masterShieldedRoot, uint256 masterWormholeRoot)",
])
