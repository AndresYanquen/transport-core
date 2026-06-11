const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

export function buildApiUrl(path) {
  if (!path) return apiBaseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

export async function apiRequest(path, options = {}) {
  const { body, headers, ...rest } = options;

  const resolvedHeaders = {
    Accept: "application/json",
    ...headers,
  };

  const init = {
    headers: resolvedHeaders,
    ...rest,
  };

  if (body !== undefined) {
    init.body =
      typeof body === "string" || body instanceof FormData ? body : JSON.stringify(body);

    if (!(body instanceof FormData) && !init.headers["Content-Type"]) {
      init.headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(buildApiUrl(path), init);
  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = data?.message || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    error.reason = "request_failed";
    throw error;
  }

  return data;
}

function safeJsonParse(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
