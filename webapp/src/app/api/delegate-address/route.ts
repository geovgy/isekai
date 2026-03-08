import { NextResponse } from "next/server";
import { privateKeyToAccount } from "viem/accounts";

export async function GET() {
  const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY! as `0x${string}`);
  return NextResponse.json({ address: account.address });
}