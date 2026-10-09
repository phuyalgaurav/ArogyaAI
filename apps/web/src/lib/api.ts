import type {
  ArogyaResponse,
  Capabilities,
  ChatRequest,
  ConsentGrant,
  ConsentRequest,
  KnowledgeSource,
  MedicineRecord,
  MedicineResolution,
  MedicineResolveRequest,
  ModelAction,
  ReviewedQuestion,
  RuntimeStatus,
  SessionResponse,
  WorkerRuntime,
} from "@arogya/contracts";

export type Language = "en" | "ne" | "tam";

// getRandomValues also works on a phone connected over local-network HTTP.
export function createRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export class ApiError extends Error {
  status: number;
  detail: string;
  errors?: Array<{ type: string }>;
  constructor(
    status: number,
    detail: string,
    errors?: Array<{ type: string }>,
  ) {
    super(`API error ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || "";
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as unknown as T;
  }
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const detail = data?.detail || response.statusText || "request_failed";
    throw new ApiError(response.status, detail, data?.errors);
  }
  return data as T;
}

export async function fetchCapabilities(
  signal?: AbortSignal,
): Promise<Capabilities> {
  const url = `${getApiBaseUrl()}/api/v1/capabilities`;
  const response = await fetch(url, {
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<Capabilities>(response);
}

export async function fetchRuntime(
  signal?: AbortSignal,
): Promise<RuntimeStatus> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/runtime`, {
    signal: signal || AbortSignal.timeout(10000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<RuntimeStatus>(response);
}

export async function createSession(
  signal?: AbortSignal,
): Promise<SessionResponse> {
  const url = `${getApiBaseUrl()}/api/v1/session`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<SessionResponse>(response);
}

export async function createConsent(
  token: string,
  expiresInSeconds: number = 3600,
  signal?: AbortSignal,
  purpose: ConsentRequest["purpose"] = "server_chat",
  category: ConsentRequest["data_categories"][number] = "message_text",
): Promise<ConsentGrant> {
  const payload: ConsentRequest = {
    purpose,
    data_categories: [category],
    expires_in_seconds: expiresInSeconds,
  };
  const url = `${getApiBaseUrl()}/api/v1/consents`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<ConsentGrant>(response);
}

export async function getConsent(
  token: string,
  consentId: string,
  signal?: AbortSignal,
): Promise<ConsentGrant> {
  const url = `${getApiBaseUrl()}/api/v1/consents/${encodeURIComponent(consentId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<ConsentGrant>(response);
}

export async function revokeConsent(
  token: string,
  consentId: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${getApiBaseUrl()}/api/v1/consents/${encodeURIComponent(consentId)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<void>(response);
}

export async function sendChatMessage(
  token: string,
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<ArogyaResponse> {
  const url = `${getApiBaseUrl()}/api/v1/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
    signal: signal || AbortSignal.timeout(15000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<ArogyaResponse>(response);
}

export async function fetchQuestions(
  language: Language = "en",
  limit: number = 50,
  signal?: AbortSignal,
): Promise<ReviewedQuestion[]> {
  const url = `${getApiBaseUrl()}/api/v1/knowledge/questions?language=${encodeURIComponent(language)}&limit=${limit}`;
  const response = await fetch(url, {
    method: "GET",
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<ReviewedQuestion[]>(response);
}

export async function fetchSource(
  sourceId: string,
  signal?: AbortSignal,
): Promise<KnowledgeSource> {
  const url = `${getApiBaseUrl()}/api/v1/knowledge/sources/${encodeURIComponent(sourceId)}`;
  const response = await fetch(url, {
    method: "GET",
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<KnowledgeSource>(response);
}

export async function resolveMedicine(
  query: string,
  signal?: AbortSignal,
): Promise<MedicineResolution> {
  const payload: MedicineResolveRequest = { query };
  const url = `${getApiBaseUrl()}/api/v1/medicines/resolve`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<MedicineResolution>(response);
}

export async function fetchMedicine(
  medicineId: string,
  signal?: AbortSignal,
): Promise<MedicineRecord> {
  const url = `${getApiBaseUrl()}/api/v1/medicines/${encodeURIComponent(medicineId)}`;
  const response = await fetch(url, {
    method: "GET",
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<MedicineRecord>(response);
}

export async function exportUserData(
  token: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = `${getApiBaseUrl()}/api/v1/me/data`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<Record<string, unknown>>(response);
}

export async function deleteUserData(
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${getApiBaseUrl()}/api/v1/me/data`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<void>(response);
}

export interface KnowledgeManifestResponse {
  offline_bundle_available?: boolean;
  bundles?: Array<{
    bundle_id: string;
    version: string;
    language: string;
    payload_sha256: string;
    valid_until: string;
  }>;
  total_sources?: number;
}

export interface SigningKeyDescriptor {
  key_id: string;
  algorithm: string;
  public_key: string;
}

export async function fetchKnowledgeManifest(
  signal?: AbortSignal,
): Promise<KnowledgeManifestResponse> {
  const url = `${getApiBaseUrl()}/api/v1/knowledge/manifest`;
  const response = await fetch(url, {
    method: "GET",
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<KnowledgeManifestResponse>(response);
}

export async function fetchSigningKey(
  signal?: AbortSignal,
): Promise<SigningKeyDescriptor> {
  const url = `${getApiBaseUrl()}/api/v1/knowledge/signing-key`;
  const response = await fetch(url, {
    method: "GET",
    signal: signal || AbortSignal.timeout(5000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<SigningKeyDescriptor>(response);
}

export async function manageOperatorModel(
  operatorToken: string,
  payload: ModelAction,
  signal?: AbortSignal,
): Promise<WorkerRuntime> {
  const url = `${getApiBaseUrl()}/api/v1/operator/models/qwen`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${operatorToken.trim()}`,
    },
    body: JSON.stringify(payload),
    signal: signal || AbortSignal.timeout(15000),
    cache: "no-store",
    credentials: "omit",
  });
  return handleResponse<WorkerRuntime>(response);
}
