import type { IncomingMessage, ServerResponse } from "node:http";
import {
  handleX402ReceiveRequest,
  loadX402ReceiveConfig,
  verifyFacilitatorSupport
} from "../../src/x402/receive-server.js";

// Vercel Node.js function adapter. Payment remains disabled unless explicitly enabled
// with valid deployment environment variables. No wallet keys are used by this endpoint.
let facilitatorReady: Promise<void> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const config = loadX402ReceiveConfig(process.env);
    if (config.enabled) {
      if (!facilitatorReady) {
        facilitatorReady = verifyFacilitatorSupport(config).catch((error: unknown) => {
          facilitatorReady = undefined;
          throw error;
        });
      }
      await facilitatorReady;
    }
    await handleX402ReceiveRequest(req, res, config);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify({
        error: "X402_RECEIVER_NOT_CONFIGURED_OR_UNAVAILABLE",
        paymentExecutionEnabled: false
      }));
    } else {
      res.destroy();
    }
  }
}
