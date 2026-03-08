import { SUPPORTED_CHAINS, getChainConfig } from "@/src/chains";
import { ShieldedTx, ShieldedTxStringified } from "@/src/types";
import { NextRequest, NextResponse } from "next/server";
import { Abi, createWalletClient, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const verifierAbi = [
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "_proof", type: "bytes" },
      { name: "_publicInputs", type: "bytes32[]" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "error",
    name: "ProofLengthWrong",
    inputs: [],
  },
  {
    type: "error",
    name: "ProofLengthWrongWithLogN",
    inputs: [
      { name: "logN", type: "uint256" },
      { name: "actualLength", type: "uint256" },
      { name: "expectedLength", type: "uint256" }
    ],
  },
  {
    type: "error",
    name: "PublicInputsLengthWrong",
    inputs: [],
  },
  {
    type: "error",
    name: "SumcheckFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "ShpleminiFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "GeminiChallengeInSubgroup",
    inputs: [],
  },
  {
    type: "error",
    name: "ConsistencyCheckFailed",
    inputs: [],
  }
] as const satisfies Abi

function getRelayerRpcUrl(chainId: number): string {
  const chainConfig = SUPPORTED_CHAINS[chainId];
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return chainConfig.rpcUrl;
}

export async function POST(request: NextRequest) {
  console.log("Received shielded transfer request");
  try {
    const body = await request.json();
    console.log("Received shielded transfer request", body);
    const { shieldedTx: shieldedTxStringified, proof, chainId } = body as {
      shieldedTx: ShieldedTxStringified;
      proof: `0x${string}`;
      chainId?: number | string;
    };

    console.log("Received shielded transfer request", { chainId, shieldedTxChainId: shieldedTxStringified?.chainId });

    const shieldedTx: ShieldedTx = {
      ...shieldedTxStringified,
      chainId: BigInt(shieldedTxStringified.chainId),
      commitments: shieldedTxStringified.commitments.map(commitment => BigInt(commitment)),
      withdrawals: shieldedTxStringified.withdrawals.map(withdrawal => ({
        to: withdrawal.to,
        asset: withdrawal.asset,
        id: BigInt(withdrawal.id),
        amount: BigInt(withdrawal.amount),
      })),
    };

    const targetChainId = Number(chainId ?? shieldedTx.chainId);
    const chainConfig = SUPPORTED_CHAINS[targetChainId];
    if (!chainConfig) {
      return NextResponse.json({ error: `Unsupported chain ID: ${targetChainId}` }, { status: 400 });
    }

    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: "RELAYER_PRIVATE_KEY not configured" }, { status: 500 });
    }
    const relayer = privateKeyToAccount(privateKey as `0x${string}`)
    const rpcUrl = getRelayerRpcUrl(targetChainId);

    console.log(`Creating wallet client for chain ${chainConfig.label}`);
    const client = createWalletClient({
      account: relayer,
      chain: chainConfig.chain,
      transport: http(rpcUrl),
    })

    console.log("Writing contract");
    const hash = await client.writeContract({
      address: getAddress(getChainConfig(targetChainId).branchContractAddress),
      abi: [...verifierAbi, ...parseAbi([
        "struct Withdrawal { address to; address asset; uint256 id; uint256 amount; }",
        "struct ShieldedTx { uint64 chainId; bytes32 wormholeRoot; bytes32 wormholeNullifier; bytes32 shieldedRoot; bytes32[] nullifiers; uint256[] commitments; Withdrawal[] withdrawals; }",
        "function shieldedTransfer(ShieldedTx memory shieldedTx, bytes calldata proof) external",
      ])],
      functionName: "shieldedTransfer",
      args: [shieldedTx, proof],
    })

    console.log("Transaction hash:", hash);

    return NextResponse.json({ hash }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}