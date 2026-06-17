"use client";

import { useEffect, useState, useRef } from "react";

declare global {
  interface Window {
    google?: any;
  }
}

let loadingPromise: Promise<void> | null = null;

export function useGoogleCharts(packages: string[] = ["corechart"]) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (typeof window === "undefined") return;

    if (window.google?.visualization) {
      setLoaded(true);
      return;
    }

    if (!loadingPromise) {
      loadingPromise = new Promise<void>((resolve, reject) => {
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
      });
    } else {
      loadingPromise.then(() => {
        if (mountedRef.current && window.google?.visualization) {
          setLoaded(true);
        }
      });
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { loaded, error };
}
