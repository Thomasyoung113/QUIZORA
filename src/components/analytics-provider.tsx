"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

let initialized = false;

export function initPosthog() {
  if (initialized || typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return; // no-op without key
  initialized = true;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false, // manual capture below for App Router
    persistence: "localStorage+cookie",
  });
}

export function track(event: string, props?: Record<string, unknown>) {
  try {
    if (initialized) posthog.capture(event, props);
  } catch {
    /* analytics must never break the game */
  }
}

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initPosthog();
    // manual pageview on route change (App Router has no router events)
    let lastPath = window.location.pathname;
    track("$pageview", { $current_url: window.location.href });
    const observer = new MutationObserver(() => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        track("$pageview", { $current_url: window.location.href });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return <>{children}</>;
}
