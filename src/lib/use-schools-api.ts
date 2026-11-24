/** GET a schools API path (src/worker/schools-api.ts); refetches when the path changes or on reload(). */
import { useEffect, useState } from 'react';

export interface Loaded<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

export function useSchoolsApi<T>(path: string | null): Loaded<T> {
  const [tick, setTick] = useState(0);
  const key = path == null ? null : `${path}#${tick}`;
  // The last answer and which request it answered; `loading` is derived, so the effect only sets state from callbacks.
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null });
  useEffect(() => {
    if (!path || !key) return;
    let live = true;
    fetch(path)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
        if (!res.ok) throw new Error(body?.message ?? `The server answered ${res.status}.`);
        return body as T;
      })
      .then((data) => { if (live) setState({ key, data, error: null }); })
      .catch((e: Error) => { if (live) setState({ key, data: null, error: e.message }); });
    return () => { live = false; };
  }, [path, key]);
  const current = state.key === key;
  return {
    // The previous answer stays while the next loads (lists keep their rows while a filter changes).
    data: path == null ? null : state.data,
    error: current ? state.error : null,
    loading: path != null && !current,
    reload: () => setTick((t) => t + 1),
  };
}
