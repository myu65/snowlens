"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// URL identifiers are navigation hints. `apply` must fetch current permissions
// and data; this hook never executes writes or restores input drafts from URLs.
export function useUrlState<T>(
  snapshot: T,
  options: {
    ready: boolean;
    parse: (url: URL) => T;
    format: (value: T) => string;
    apply: (value: T, signal: AbortSignal) => Promise<void>;
    onError: (error: Error) => void;
    onFormatError?: (error: Error) => void;
  },
) {
  const callbacks = useRef(options),
    activeRead = useRef<AbortController | undefined>(undefined),
    lastHref = useRef(""),
    failedSnapshot = useRef<string | undefined>(undefined),
    failed = useRef(false),
    replaceNext = useRef(false),
    loading = useRef(true);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    callbacks.current = options;
  });
  useEffect(() => {
    if (!options.ready) return;
    let controller: AbortController | undefined;
    async function read(pop = false) {
      if (
        pop &&
        !window.dispatchEvent(
          new Event("snowlens-leave-draft", { cancelable: true }),
        )
      ) {
        window.history.pushState(window.history.state, "", lastHref.current);
        return;
      }
      controller?.abort();
      const next = new AbortController();
      controller = next;
      activeRead.current = next;
      loading.current = true;
      failed.current = false;
      failedSnapshot.current = undefined;
      lastHref.current = window.location.pathname + window.location.search;
      setRestoring(true);
      try {
        const target = callbacks.current.parse(new URL(window.location.href));
        await callbacks.current.apply(target, next.signal);
      } catch (error) {
        if (!next.signal.aborted) {
          failed.current = true;
          callbacks.current.onError(
            error instanceof Error
              ? error
              : new Error("URLの指定を確認してください。"),
          );
        }
      } finally {
        if (!next.signal.aborted) {
          loading.current = false;
          replaceNext.current = true;
          setRestoring(false);
        }
      }
    }
    const timer = setTimeout(() => void read(), 0);
    const pop = () => void read(true);
    window.addEventListener("popstate", pop);
    return () => {
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("popstate", pop);
    };
  }, [options.ready]);
  useLayoutEffect(() => {
    if (!options.ready || restoring || loading.current) return;
    let href: string;
    try {
      href = options.format(snapshot);
    } catch (error) {
      (callbacks.current.onFormatError || callbacks.current.onError)(
        error instanceof Error ? error : new Error("リンクを作れません。"),
      );
      return;
    }
    // Keep an invalid URL visible until the user actually chooses another screen.
    if (failed.current) {
      if (failedSnapshot.current === undefined) failedSnapshot.current = href;
      if (failedSnapshot.current === href) return;
      failed.current = false;
    }
    if (href === lastHref.current) {
      replaceNext.current = false;
      return;
    }
    if (replaceNext.current)
      window.history.replaceState(window.history.state, "", href);
    else window.history.pushState(window.history.state, "", href);
    replaceNext.current = false;
    lastHref.current = href;
  }, [snapshot, options, restoring]);
  return {
    restoring,
    cancelRestore: () => {
      activeRead.current?.abort();
      loading.current = false;
      failed.current = false;
      failedSnapshot.current = undefined;
      replaceNext.current = false;
      setRestoring(false);
    },
    replaceNextWrite: () => {
      replaceNext.current = true;
    },
  };
}
