"use client";
import { useEffect, useState } from "react";
import { Triangle, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { vercelStatus, connectVercel, disconnectVercel } from "@/lib/mutations";

// Global Vercel connection (one token per engine, like the GitHub token). Once
// connected, the engine follows the Vercel deploy each push triggers and
// auto-fixes failed builds from the job's chat. Lives on the settings page.

export function VercelConnect() {
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    vercelStatus()
      .then((s) => { setUsername(s.username); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function connect() {
    if (!token.trim()) { toast.error("Paste a Vercel token"); return; }
    setBusy(true);
    try {
      const r = await connectVercel(token.trim(), teamId.trim() || undefined);
      setUsername(r.username);
      setToken(""); setTeamId("");
      toast.success(`Connected to Vercel as ${r.username}`);
    } catch {
      toast.error("Invalid Vercel token");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectVercel();
      setUsername("");
      toast.success("Disconnected from Vercel");
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <Triangle className="w-3.5 h-3.5 fill-ink text-ink" /> Vercel deploys
        <span className="font-data text-[10px] uppercase tracking-wide text-muted">applies to all projects</span>
      </label>
      <p className="text-[12px] text-muted">
        Connect Vercel and Factory follows the deploy each push triggers — on a failed build it pulls the
        error log into the job chat and auto-fixes it (up to 2 tries), then re-pushes.
      </p>

      {username ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-paper border border-[#332f28] px-3 py-2">
          <span className="flex items-center gap-2 text-[13px] text-ink">
            <span className="w-2 h-2 rounded-full bg-[#4ade80] flex-shrink-0" />
            Connected as <b className="font-data">{username}</b>
          </span>
          <button
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#332f28] text-[12px] text-muted hover:text-ink hover:border-[#f4604f] transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />} Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Vercel API token (vercel.com/account/tokens)"
            className="w-full rounded-md bg-paper border border-[#332f28] px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:border-[#b08a3e]"
          />
          <input
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            placeholder="Team ID (optional — leave blank for a personal account)"
            className="w-full rounded-md bg-paper border border-[#332f28] px-3 py-2 font-mono text-[12px] text-ink placeholder:text-muted focus:outline-none focus:border-[#b08a3e]"
          />
          <button
            onClick={connect}
            disabled={busy || !token.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-ink text-paper font-bold text-[13px] disabled:opacity-40 hover:brightness-110 transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy ? "Connecting…" : "Connect Vercel"}
          </button>
        </div>
      )}
    </div>
  );
}
