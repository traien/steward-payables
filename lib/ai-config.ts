export type AIProvider = "openai" | "compatible";
export type AIConfiguration = {
  provider: AIProvider;
  apiKey: string;
  model: string;
  endpoint: string;
};

export function isAIEnabled(): boolean {
  return process.env.STEWARD_ENABLE_AI === "true";
}

export function getAIConfiguration(): AIConfiguration | null {
  if (!isAIEnabled()) return null;

  const provider = process.env.STEWARD_AI_PROVIDER?.trim();
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey)
      throw new Error("OPENAI_API_KEY is required for OpenAI review.");
    return {
      provider,
      apiKey,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
      endpoint: "https://api.openai.com/v1/responses",
    };
  }

  if (provider !== "compatible") {
    throw new Error("Select STEWARD_AI_PROVIDER before enabling AI review.");
  }

  // A compatible provider never borrows an OpenAI credential or model setting.
  const apiKey = process.env.STEWARD_AI_API_KEY?.trim();
  const model = process.env.STEWARD_AI_MODEL?.trim();
  if (!apiKey || !model) {
    throw new Error(
      "Set STEWARD_AI_API_KEY and STEWARD_AI_MODEL for provider review.",
    );
  }

  let base: URL;
  try {
    base = new URL(process.env.STEWARD_AI_BASE_URL?.trim() || "");
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.href.includes("?") ||
      base.href.includes("#")
    )
      throw new Error("Invalid provider URL.");
  } catch {
    // Do not include the configured URL: it may contain an accidental secret.
    throw new Error(
      "STEWARD_AI_BASE_URL must be an HTTPS URL without credentials, query, or fragment.",
    );
  }

  return {
    provider,
    apiKey,
    model,
    endpoint: `${base.href.replace(/\/+$/, "")}/chat/completions`,
  };
}

export function getAIStatus() {
  try {
    const config = getAIConfiguration();
    return config ? { ai: true, aiProvider: config.provider } : { ai: false };
  } catch (error) {
    return {
      ai: false,
      aiConfigurationError:
        error instanceof Error ? error.message : "AI setup is incomplete.",
    };
  }
}
