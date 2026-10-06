/**
 * Minimal Ollama HTTP client.
 *
 * Only the two endpoints the pool needs. No SDK, because the SDK is a
 * transitive dependency we do not otherwise want, and the wire format here is
 * three fields.
 */

const HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

export const MODELS = {
  /** Classification. Structured output, low temperature. */
  classify: process.env.POOL_MODEL_CLASSIFY ?? 'qwen2.5-coder:14b',
  /** Description drafting. Weak, so its output is always unverified. */
  describe: process.env.POOL_MODEL_DESCRIBE ?? 'qwen2.5-coder:14b',
  /** Semantic dedup. */
  embed: process.env.POOL_MODEL_EMBED ?? 'bge-m3:latest',
} as const;

export class OllamaError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${HOST}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = (error as Error).name === 'AbortError' ? `timed out after ${timeoutMs}ms` : (error as Error).message;
    throw new OllamaError(
      `Ollama request to ${path} failed: ${reason}`,
      `Is the server running? Try: ollama serve   (then: ollama list)`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new OllamaError(
      `Ollama returned ${response.status} for ${path}: ${body.slice(0, 300)}`,
      `Is the model pulled? Try: ollama pull ${MODELS.classify}`,
    );
  }

  return (await response.json()) as T;
}

export async function isServerUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  }
}

export interface TagModel {
  name: string;
  size: number;
}

export async function listModels(): Promise<TagModel[]> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);
  const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal });
  if (!res.ok) throw new OllamaError('cannot list models', 'ollama serve');
  const data = (await res.json()) as { models?: TagModel[] };
  return data.models ?? [];
}

export async function isModelAvailable(name: string): Promise<boolean> {
  const models = await listModels();
  return models.some((m) => m.name === name || m.name.split(':')[0] === name.split(':')[0]);
}

/**
 * Generates JSON. `format: 'json'` makes Ollama constrain decoding to valid
 * JSON, which removes the whole class of "model wrapped it in ```json fences"
 * failures. We still validate the result with Zod, because valid JSON is not
 * the same as a valid classification.
 */
export async function generateJson<T>(
  model: string,
  prompt: string,
  parse: (raw: unknown) => T,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const data = await call<{ response?: string }>(
    '/api/generate',
    {
      model,
      stream: false,
      format: 'json',
      // temperature 0: classification must be reproducible, or re-running the
      // pool on unchanged input would produce different files every time.
      options: { temperature: 0, num_predict: 400 },
      prompt,
    },
    opts.timeoutMs ?? 120_000,
  );

  const text = (data.response ?? '').trim();
  if (!text) throw new OllamaError('model returned an empty response', 'try a different model');

  try {
    return parse(JSON.parse(text));
  } catch (error) {
    throw new OllamaError(
      `model returned JSON that failed validation: ${text.slice(0, 200)}`,
      `validation error: ${(error as Error).message}`,
    );
  }
}

export async function embed(model: string, input: string): Promise<number[]> {
  const data = await call<{ embeddings?: number[][] }>(
    '/api/embed',
    { model, input },
    60_000,
  );
  const vector = data.embeddings?.[0];
  if (!vector) throw new OllamaError('no embedding returned', `ollama pull ${model}`);
  return vector;
}

/**
 * Cosine similarity. Both bge-m3 vectors are already L2-normalised by Ollama,
 * but normalising here too means the result does not silently change if that
 * ever stops being true.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
