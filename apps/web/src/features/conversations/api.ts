import { ApiError, getApiBaseUrl } from "@/lib/api";

export interface ConversationAccess {
  token: string;
  historyToken?: string;
}

export async function conversationRequest<T>(
  access: ConversationAccess,
  path = "",
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/v1/conversations${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${access.token}`,
        ...(access.historyToken
          ? { "X-History-Token": access.historyToken }
          : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(170000)])
        : AbortSignal.timeout(170000),
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (response.status === 204) return undefined as T;
  let result: T & { detail?: string | { message?: string } };
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? 502 : response.status,
      "The server connection was interrupted. Your draft is still here. Retry when the server is available, or choose the smaller Qwen model in Processing options.",
    );
  }
  if (!response.ok) {
    const detail = result.detail;
    throw new ApiError(
      response.status,
      typeof detail === "string"
        ? detail
        : detail?.message || "Conversation request failed.",
    );
  }
  return result as T;
}
