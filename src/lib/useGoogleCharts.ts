"use client";

import { useEffect, useState, useRef } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

// Key: sorted package names joined -> Promise
const loadCache = new Map<string, Promise<void>>();

export function useGoogleCharts(packages: string[] = ["corechart"]) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const cacheKey = [...packages].sort().join(",");

  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === "undefined") return;

    if (window.google?.visualization) {
      setLoaded(true);
      return;
    }

    if (!loadCache.has(cacheKey)) {
      const promise = new Promise<void>((resolve, reject) => {
        // Lazy-load loader.js only once
        if (!document.querySelector('script[src*="gstatic.com/charts/loader.js"]')) {
          const script = document.createElement("script");
          script.src = "https://www.gstatic.com/charts/loader.js";
          script.async = true;
          script.onload = () => {
            window.google.charts.load("current", { packages });
            window.google.charts.setOnLoadCallback(() => {
              if (mountedRef.current) setLoaded(true);
              resolve();
            });
          };
          script.onerror = () => {
            if (mountedRef.current) setError("Google Charts yüklenemedi");
            reject(new Error("Failed to load Google Charts"));
          };
          document.head.appendChild(script);
        } else {
          // Loader already exists, just load new packages
          window.google.charts.load("current", { packages });
          window.google.charts.setOnLoadCallback(() => {
            if (mountedRef.current) setLoaded(true);
            resolve();
          });
        }
      });
      loadCache.set(cacheKey, promise);
    } else {
      loadCache.get(cacheKey)!.then(() => {
        if (mountedRef.current && window.google?.visualization) {
          setLoaded(true);
        }
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, [cacheKey]);

  return { loaded, error };
}
