"use client";

import { useEffect, useState, useRef } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

type LoadState = "idle" | "loading" | "loaded" | "error";
const loadStates = new Map<string, LoadState>();
const loadPromises = new Map<string, Promise<void>>();
const loadCallbacks = new Map<string, Set<() => void>>();

function waitForCharts(packages: string[]): Promise<void> {
  const key = [...packages].sort().join(",");
  const existing = loadPromises.get(key);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    // If already fully loaded
    if (window.google?.visualization) {
      resolve();
      return;
    }

    const cbSet = loadCallbacks.get(key) || new Set();
    cbSet.add(() => resolve());
    loadCallbacks.set(key, cbSet);

    // Only start loading once
    if (loadStates.get(key) === "loading" || loadStates.get(key) === "loaded")
      return;
    loadStates.set(key, "loading");

    // Helper: retry until window.google?.charts is available
    const safeLoad = (attempts = 0) => {
      if (window.google?.charts?.load) {
        try {
          window.google.charts.load("current", { packages });
          window.google.charts.setOnLoadCallback(() => {
            loadStates.set(key, "loaded");
            const cbs = loadCallbacks.get(key);
            if (cbs) cbs.forEach((fn) => fn());
            loadCallbacks.delete(key);
          });
        } catch (e) {
          if (attempts < 20) {
            setTimeout(() => safeLoad(attempts + 1), 200);
          } else {
            loadStates.set(key, "error");
            reject(e);
          }
        }
      } else if (attempts < 20) {
        setTimeout(() => safeLoad(attempts + 1), 200);
      } else {
        loadStates.set(key, "error");
        reject(new Error("Google Charts API not available"));
      }
    };

    if (
      !document.querySelector('script[src*="gstatic.com/charts/loader.js"]')
    ) {
      const script = document.createElement("script");
      script.src = "https://www.gstatic.com/charts/loader.js";
      script.async = true;
      script.onload = () => safeLoad();
      script.onerror = () => {
        loadStates.set(key, "error");
        reject(new Error("Failed to load Google Charts"));
      };
      document.head.appendChild(script);
    } else {
      safeLoad();
    }
  });

  loadPromises.set(key, promise);
  return promise;
}

export function useGoogleCharts(packages: string[] = ["corechart"]) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === "undefined" || window.google?.visualization) {
      setLoaded(true);
      return;
    }

    waitForCharts(packages)
      .then(() => {
        if (mountedRef.current) setLoaded(true);
      })
      .catch((e) => {
        if (mountedRef.current)
          setError(e?.message || "Google Charts yüklenemedi");
      });

    return () => {
      mountedRef.current = false;
    };
    // Only run once — the waitForCharts function handles dedup internally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loaded, error };
}
