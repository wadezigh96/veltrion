import { createX402ReceiveServer, loadX402ReceiveConfig, verifyFacilitatorSupport } from "./receive-server.js";

async function main() {
try {
  const config = loadX402ReceiveConfig();
  if (config.enabled) await verifyFacilitatorSupport(config);
  const server = createX402ReceiveServer(config);
  server.listen(config.port, config.host, () => {
    process.stdout.write(JSON.stringify({
      service: "VELTRION x402 receiver",
      host: config.host,
      port: config.port,
      enabled: config.enabled,
      network: "eip155:8453",
      endpoint: "/api/paid/summary",
      paymentExecutionEnabled: config.enabled
    }) + "\n");
  });
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "X402_RECEIVER_CONFIG_INVALID";
  process.stderr.write(JSON.stringify({ error: code, serverStarted: false }) + "\n");
  process.exitCode = 1;
}
}

void main();
