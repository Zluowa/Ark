import { getPlatformContract } from "@/lib/server/platform-contract";

export const dynamic = "force-static";

export function GET() {
  return Response.json(getPlatformContract());
}
