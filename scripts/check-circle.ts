import { getWalletBalance } from "../lib/circle.ts";

// This command only reads the configured wallet and its balance.
// The payment runner, transfer API and AI planner are never called.
try {
  const { address, balanceCents } = await getWalletBalance();
  const cents = BigInt(balanceCents);
  console.log(
    JSON.stringify(
      {
        status: "connection_verified",
        network: "ARC-TESTNET",
        walletAddress: address,
        balanceUSDC: `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`,
        balancePrecision: "Rounded down to cents; no token entry reports zero.",
        paymentVerified: false,
        paymentsSubmitted: 0,
      },
      null,
      2,
    ),
  );
} catch {
  // Never print credentials, raw provider bodies or thrown provider messages.
  console.error(
    "Circle connection could not be verified. Check the test API key, wallet ID, Arc testnet network and network access. No payment was submitted.",
  );
  process.exitCode = 1;
}
