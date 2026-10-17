import { verifyVeltrionLlmConnection } from "../src/llm/agent.js";

if (process.env.VELTRION_ALLOW_LIVE_LLM_TEST !== "1") {
  console.error("Blocked: set VELTRION_ALLOW_LIVE_LLM_TEST=1 to explicitly allow one billable provider smoke test.");
  process.exitCode = 1;
} else if (!process.env.AI_GATEWAY_API_KEY?.trim() || !process.env.VELTRION_LLM_MODEL?.trim()) {
  console.error("Missing AI_GATEWAY_API_KEY or VELTRION_LLM_MODEL. Set both locally; never paste them into chat or commit them.");
  process.exitCode = 1;
} else {
  try {
    const result = await verifyVeltrionLlmConnection();
    if (!result.answer.includes("VELTRION_LLM_LIVE_OK")) {
      console.error("Connectivity check did not return the expected response.");
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({
        ok: true,
        provider: "vercel-ai-gateway",
        model: result.model,
        toolsUsed: [],
        executionEnabled: false,
        response: result.answer,
        note: "This checks text generation only; agent tool round-trips are tested separately."
      }, null, 2));
    }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "LLM_LIVE_SMOKE_TEST_FAILED";
    console.error(JSON.stringify({
      ok: false,
      error: code,
      note: "No transaction or payment was attempted. Provider details and credentials are intentionally omitted."
    }, null, 2));
    process.exitCode = 1;
  }
}
