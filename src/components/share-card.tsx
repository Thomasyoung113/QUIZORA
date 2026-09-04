"use client";

import { useMemo, useState } from "react";

interface ShareCardProps {
  playerName: string;
  rank: number;
  playerCount: number;
  points: number;
  correct: number;
  answered: number;
  roomCode: string;
}

const CARD_W = 1080;
const CARD_H = 1350;

export default function ShareCard({
  playerName,
  rank,
  playerCount,
  points,
  correct,
  answered,
  roomCode,
}: ShareCardProps) {
  const supported = useMemo(() => {
    try {
      const c = document.createElement("canvas");
      return !!c.getContext("2d");
    } catch {
      return false;
    }
  }, []);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : null;

  function draw(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) throw new Error("canvas unsupported");

    // Background: ink stage with violet glow + arena grid
    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, "#14121f");
    g.addColorStop(0.55, "#1d1a2e");
    g.addColorStop(1, "#14121f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    const glow = ctx.createRadialGradient(CARD_W / 2, -100, 50, CARD_W / 2, -100, 900);
    glow.addColorStop(0, "rgba(143,123,255,0.25)");
    glow.addColorStop(1, "rgba(143,123,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CARD_W, 1100);
    ctx.strokeStyle = "rgba(244,239,227,0.05)";
    ctx.lineWidth = 2;
    for (let x = 0; x < CARD_W; x += 72) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CARD_H); ctx.stroke();
    }
    for (let y = 0; y < CARD_H; y += 72) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CARD_W, y); ctx.stroke();
    }

    ctx.textAlign = "center";

    // Wordmark: QUIZ paper + ORA lime
    ctx.font = "900 110px system-ui, -apple-system, sans-serif";
    const quizW = ctx.measureText("QUIZ").width;
    const oraW = ctx.measureText("ORA").width;
    const startX = CARD_W / 2 - (quizW + oraW) / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = "#f4efe3";
    ctx.fillText("QUIZ", startX, 190);
    ctx.fillStyle = "#c8f135";
    ctx.fillText("ORA", startX + quizW, 190);
    ctx.textAlign = "center";

    ctx.font = "500 40px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(244,239,227,0.55)";
    ctx.fillText("Think. Play. Discover.", CARD_W / 2, 260);

    // Player name
    ctx.font = "700 72px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#f4efe3";
    ctx.fillText(playerName.slice(0, 24), CARD_W / 2, 470);

    // Big points
    ctx.font = "900 220px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#c8f135";
    ctx.fillText(String(points), CARD_W / 2, 720);
    ctx.font = "600 44px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(244,239,227,0.55)";
    ctx.fillText("POINTS", CARD_W / 2, 790);

    // Rank + accuracy line
    ctx.font = "600 52px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(244,239,227,0.85)";
    const rankText = `Rank #${rank} of ${playerCount}`;
    const accText = accuracy !== null ? `${correct}/${answered} correct · ${accuracy}%` : null;
    ctx.fillText(accText ? `${rankText}   ·   ${accText}` : rankText, CARD_W / 2, 900);

    // Room code pill
    const pillW = 460;
    const pillH = 110;
    const pillX = CARD_W / 2 - pillW / 2;
    const pillY = 990;
    ctx.fillStyle = "rgba(244,239,227,0.06)";
    ctx.strokeStyle = "rgba(244,239,227,0.25)";
    ctx.lineWidth = 2;
    const r = 28;
    ctx.beginPath();
    ctx.moveTo(pillX + r, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
    ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = "700 48px ui-monospace, monospace";
    ctx.fillStyle = "#c8f135";
    ctx.fillText(`ROOM ${roomCode}`, CARD_W / 2, pillY + pillH / 2 + 16);

    // Footer
    ctx.font = "500 34px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "rgba(244,239,227,0.4)";
    ctx.fillText("QUIZORA© 2026 — play at quizora-phi.vercel.app", CARD_W / 2, 1240);

    return canvas;
  }

  async function toBlob(): Promise<Blob | null> {
    const canvas = draw();
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  async function share() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await toBlob();
      if (!blob) throw new Error("render failed");
      const file = new File([blob], "quizora-result.png", { type: "image/png" });
      const summary = `I scored ${points} pts (${rank}/${playerCount}) in QUIZORA room ${roomCode} — beat me: quizora-phi.vercel.app`;
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: summary, title: "QUIZORA" });
        setNote("Shared");
      } else {
        await navigator.clipboard.writeText(summary);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "quizora-result.png";
        a.click();
        URL.revokeObjectURL(url);
        setNote("Copied summary + saved card");
      }
    } catch {
      setNote("Share failed — try Save image");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const blob = await toBlob();
      if (!blob) throw new Error("render failed");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "quizora-result.png";
      a.click();
      URL.revokeObjectURL(url);
      setNote("Saved");
    } catch {
      setNote("Could not generate image");
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={share}
          disabled={busy}
          className="q-btn q-btn-primary rounded-xl py-3.5 disabled:opacity-50"
        >
          {busy ? "Working…" : "Share result"}
        </button>
        <button
          onClick={save}
          disabled={busy}
          className="q-btn q-btn-ghost rounded-xl py-3.5 disabled:opacity-50"
        >
          Save image
        </button>
      </div>
      {note && <p className="text-center text-xs text-paper/50">{note}</p>}
    </div>
  );
}
