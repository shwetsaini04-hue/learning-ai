import { allowedModels, compatibleModels, liveEnabled, providersConfigured, requiresToken, serverLimits } from "@/lib/server/config";

/** GET /api/config — public, non-secret capabilities of this deployment. */
export async function GET() {
  return Response.json(
    {
      liveEnabled: liveEnabled(),
      requiresToken: requiresToken(),
      providers: providersConfigured(),
      compatibleModels: providersConfigured().compatible ? compatibleModels() : [],
      allowedModels: allowedModels(),
      limits: serverLimits(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
