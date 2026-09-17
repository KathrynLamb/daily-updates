// app/src/api.ts
//
// A small client for the Daily Updates API. Every request carries the
// logged-in user's access token; the API decides what they may do.

import { config } from "./config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export type Api = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
};

export function createApi(
  accessToken: string,
  onUnauthorised: () => void
): Api {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${config.apiUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(
        0,
        "Can't reach the Daily Updates server. Check it is running."
      );
    }

    const payload = await response.json().catch(() => null);

    if (response.status === 401) {
      onUnauthorised();
    }

    if (!response.ok) {
      const message =
        typeof payload?.error === "string"
          ? payload.error
          : `The server returned ${response.status}.`;

      throw new ApiError(response.status, message);
    }

    return payload as T;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
  };
}
