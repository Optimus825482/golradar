// ── useMounted Hook ────────────────────────────────────────────
// Returns a ref that is true while the component is mounted.
// Use as guard in async callbacks to prevent setState after unmount.
//
// Example:
//   const mounted = useMounted();
//   fetch(url).then(data => { if (mounted.current) setData(data); });

import { useEffect, useRef } from 'react';

export function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}
