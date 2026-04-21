import { useCallback, useRef } from "react";

// Stable function identity that always calls the latest provided implementation.
// Safe for event handlers only; do not pass the returned function to effect dep arrays
// that should re-run when the logical handler changes.
export function useStableCallback<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn
): (...args: TArgs) => TReturn {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: TArgs) => ref.current(...args), []);
}
