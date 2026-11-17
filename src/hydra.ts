// Ory Hydra's admin API. Step 1 only checks that it is ready; the login and consent handlers that accept and reject
// Hydra's requests arrive in M2. The admin API is reachable only on the private Docker network (deploy/README.md).

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Hydra {
  /** True when Hydra reports itself ready (its database reachable and migrated). */
  ready: () => Promise<boolean>;
}

export function hydraAdmin(adminUrl: string, fetchImpl: Fetch = fetch): Hydra {
  return {
    ready: async () => {
      try {
        const res = await fetchImpl(`${adminUrl}/health/ready`, { signal: AbortSignal.timeout(3_000) });
        await res.body?.cancel();
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
