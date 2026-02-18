import { isAddress, type Address, type Hex } from "viem";

export const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;
export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS as Address;

export const RPC_URL_SEPOLIA = process.env.RPC_URL_SEPOLIA!;
export const SUBGRAPH_URL_SEPOLIA = process.env.SUBGRAPH_URL_SEPOLIA!;
export const RPC_URL_ARB_SEPOLIA = process.env.RPC_URL_ARB_SEPOLIA!;
export const SUBGRAPH_URL_ARB_SEPOLIA = process.env.SUBGRAPH_URL_ARB_SEPOLIA!;

if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY env var is required");
if (!CONTRACT_ADDRESS && !isAddress(CONTRACT_ADDRESS)) throw new Error("CONTRACT_ADDRESS env var is required and must be a valid address");
if (!RPC_URL_SEPOLIA) throw new Error("RPC_URL_SEPOLIA env var is required");
if (!SUBGRAPH_URL_SEPOLIA) throw new Error("SUBGRAPH_URL_SEPOLIA env var is required");
if (!RPC_URL_ARB_SEPOLIA) throw new Error("RPC_URL_ARB_SEPOLIA env var is required");
if (!SUBGRAPH_URL_ARB_SEPOLIA) throw new Error("SUBGRAPH_URL_ARB_SEPOLIA env var is required");
