/** Kevyt OpenAI-yhteensopiva /chat/completions-asiakas. Toimii LiteLLM:n ja OpenRouterin kanssa. */

export const MAX_TOKENS_CAP = 4096;
export const DEFAULT_MAX_TOKENS = 1024;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  timeoutMs?: number;
  maxTokens?: number;
  /** Injektoitava fetch (esim. llm-cassette testeissä). Oletus globalThis.fetch. */
  fetch?: typeof fetch;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export class EmptyResponseError extends Error {
  constructor(model: string) {
    super(`Model '${model}' returned an empty response`);
    this.name = "EmptyResponseError";
  }
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_CAP) {
    throw new Error(`maxTokens must be an integer between 1 and ${MAX_TOKENS_CAP}; no request was made`);
  }
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const doFetch = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(opts.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: opts.model, messages: opts.messages, max_tokens: maxTokens }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Request to model '${opts.model}' failed (${res.status} ${res.statusText}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    if (text.trim() === "") throw new EmptyResponseError(opts.model);
    return {
      text,
      model: json.model ?? opts.model,
      usage: json.usage ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens } : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request to model '${opts.model}' timed out (${timeoutMs} ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
