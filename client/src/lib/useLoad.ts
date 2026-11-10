import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

interface LoadState<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

/**
 * Loads data when `key` changes (or `reload()` is called) and ignores stale responses.
 * `key` must change whenever the inputs of `loader` change.
 */
export function useLoad<T>(loader: () => Promise<T>, key: string) {
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  const [state, setState] = useState<LoadState<T>>({ loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ data: previous.data, loading: true }));
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : 'Something went wrong';
        setState((previous) => ({ data: previous.data, error: message, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}
