"use client";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

interface UsageWindow { utilization: number; resets_at: string }

export interface UsageData {
  subscriptionType: string | null;
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  weeklyOpus: UsageWindow | null;
  weeklySonnet: UsageWindow | null;
  fetchedAt: number;
}

export function useClaudeUsage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const json = await api<UsageData & { error?: string }>("/api/usage");
      if (json.error) { setError(json.error); setData(null); }
      else { setData(json); setError(null); }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return { data, error, loading };
}

export function resetLabel(resets_at: string): string {
  const ms = new Date(resets_at).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `Resets in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs < 24) return `Resets in ${hrs} hr${rem ? ` ${rem} min` : ""}`;
  const days = Math.floor(hrs / 24);
  return `Resets in ${days} day${days > 1 ? "s" : ""}`;
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-[#d6210f]";
  if (pct >= 70) return "bg-[#b8860b]";
  return "bg-ink";
}

function UsageBar({ label, window: w }: { label: string; window: UsageWindow }) {
  const pct = Math.min(100, Math.round(w.utilization));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-data text-[11px] uppercase text-ink">{label}</span>
        <span className="font-data text-[10px] uppercase text-muted">{resetLabel(w.resets_at)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden border border-[#332f28] bg-paper">
          <div className={`h-full transition-all ${barColor(pct)}`} style={{ width: `${Math.max(pct, 1)}%` }} />
        </div>
        <span className="w-14 text-right font-data text-[10px] tabular-nums text-muted">{pct}% used</span>
      </div>
    </div>
  );
}

export function UsagePanel() {
  const { data, error, loading } = useClaudeUsage();
  if (loading) return <div className="border border-[#332f28] bg-paper p-4 font-data text-[11px] uppercase text-muted">Loading usage…</div>;
  if (error || !data) return null;

  const plan = data.subscriptionType ? data.subscriptionType.charAt(0).toUpperCase() + data.subscriptionType.slice(1) : "Claude";

  return (
    <div className="space-y-4 border border-[#332f28] bg-paper p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display uppercase text-[12px] text-ink">Plan usage limits</h3>
        <span className="bg-ink text-concrete px-2 py-0.5 font-data text-[10px] uppercase tracking-wide">{plan}</span>
      </div>
      {data.session && <UsageBar label="Current session" window={data.session} />}
      {(data.weekly || data.weeklyOpus || data.weeklySonnet) && (
        <div className="space-y-3 border-t border-[#332f28] pt-3">
          <p className="font-data text-[10px] uppercase text-muted">Weekly limits</p>
          {data.weekly && <UsageBar label="All models" window={data.weekly} />}
          {data.weeklyOpus && <UsageBar label="Opus" window={data.weeklyOpus} />}
          {data.weeklySonnet && <UsageBar label="Sonnet" window={data.weeklySonnet} />}
        </div>
      )}
    </div>
  );
}
