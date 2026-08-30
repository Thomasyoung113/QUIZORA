"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Anti-cheat client behaviors:
 * - blocks text selection + context menu on game surfaces (deterrence)
 * - counts tab switches / focus loss (shown post-game as social pressure)
 * - blurs the game area while the tab is hidden (screenshot deterrent)
 * - heartbeat + leave beacon: distinguishes deliberate leave (forfeit)
 *   from network drop (no penalty)
 */
export function useAntiCheat(gameId: string | null, playerId: string | null) {
  const [blurred, setBlurred] = useState(false);
  const switchesRef = useRef(0);
  const leftCleanRef = useRef(false);

  // Copy/selection deterrence
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    document.addEventListener("selectstart", block);
    document.addEventListener("copy", block);
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("selectstart", block);
      document.removeEventListener("copy", block);
    };
  }, []);

  // Visibility: blur + switch counting + leave beacon
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "hidden") {
        setBlurred(true);
        switchesRef.current += 1;
        if (!leftCleanRef.current && gameId && playerId) {
          // Deliberate navigation away — fire-and-forget beacon
          const body = JSON.stringify({ action: "leave", gameId, playerId });
          navigator.sendBeacon?.("/api/anticheat", new Blob([body], { type: "application/json" }));
          leftCleanRef.current = true;
        }
      } else {
        // Small delay so screen readers/refocus don't flash
        setTimeout(() => setBlurred(false), 150);
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [gameId, playerId]);

  // Heartbeat while the game is active
  useEffect(() => {
    if (!gameId || !playerId) return;
    const ping = () =>
      fetch("/api/anticheat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", gameId, playerId }),
        keepalive: true,
      }).catch(() => {});
    ping();
    const t = setInterval(ping, 5000);
    return () => clearInterval(t);
  }, [gameId, playerId]);

  return { blurred, switchesRef };
}
