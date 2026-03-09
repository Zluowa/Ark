import { getServerEnv } from "@/lib/server/env";
import type { UsageStatus } from "@/lib/server/usage-ledger";

export const resolveCreditsForStatus = (status: UsageStatus): number => {
  const env = getServerEnv();
  const baseCredits = Math.max(0, Math.floor(env.billingCreditsPerExecution));
  if (status === "succeeded") {
    return baseCredits;
  }
  if (status === "failed" && env.billingChargeOnFailure) {
    return baseCredits;
  }
  return 0;
};
