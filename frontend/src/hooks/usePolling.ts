import { useEffect, useRef, useCallback } from "react";

interface UsePollingOptions {
  interval?: number;
  enabled?: boolean;
  immediate?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  { interval = 3000, enabled = true, immediate = true }: UsePollingOptions = {}
) {
  const savedCallback = useRef(callback);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  savedCallback.current = callback;

  const tick = useCallback(async () => {
    await savedCallback.current();
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (immediate) {
      void tick();
    }

    intervalRef.current = setInterval(() => {
      void tick();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, immediate, tick]);
}
