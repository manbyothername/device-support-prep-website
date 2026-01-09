"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type DomainStat = {
  domain: string;
  total_attempts: number;
  total_correct: number;
  last_mode: string | null;
  updated_at: string;
};

type SortKey = "accuracy" | "attempts" | "domain";

function pct(correct: number, attempts: number) {
  if (!attempts) return 0;
  return Math.round((correct / attempts) * 100);
}

export default function StatsPage() {
  const [stats, setStats] = useState<DomainStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("accuracy");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  async function load() {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("domain_stats")
      .select("domain,total_attempts,total_correct,last_mode,updated_at");

    if (error) {
      setError(error.message);
      setStats([]);
      setLoading(false);
      return;
    }

    setStats((data ?? []) as DomainStat[]);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const overall = useMemo(() => {
    const attempts = stats.reduce((sum, r) => sum + (r.total_attempts ?? 0), 0);
    const correct = stats.reduce((sum, r) => sum + (r.total_correct ?? 0), 0);
    return { attempts, correct, accuracy: pct(correct, attempts) };
  }, [stats]);

  const rows = useMemo(() => {
    const withAcc = stats.map((r) => ({
      ...r,
      accuracy: pct(r.total_correct, r.total_attempts),
    }));

    const dir = sortDir === "asc" ? 1 : -1;

    withAcc.sort((a, b) => {
      if (sortKey === "domain") return a.domain.localeCompare(b.domain) * dir;
      if (sortKey === "attempts")
        return (a.total_attempts - b.total_attempts) * dir;
      return (a.accuracy - b.accuracy) * dir;
    });

    return withAcc;
  }, [stats, sortKey, sortDir]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-3xl w-full rounded-2xl border p-6">
          <p className="text-sm opacity-80">Loading stats…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-3xl w-full rounded-2xl border p-6">
          <p className="text-sm font-semibold">Couldn’t load stats</p>
          <p className="mt-2 text-sm opacity-80">{error}</p>
          <button
            className="mt-4 rounded-xl border px-4 py-2 hover:opacity-80"
            onClick={load}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 flex justify-center">
      <div className="max-w-5xl w-full">
        {/* Header / Overview */}
        <div className="rounded-2xl border p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Stats</h1>
              <p className="mt-2 text-sm opacity-80">
                Your performance by domain (from <code>domain_stats</code>).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border px-3 py-1 text-xs opacity-80">
                Overall {overall.accuracy}% ({overall.correct}/{overall.attempts})
              </span>
              <button
                className="rounded-xl border px-4 py-2 text-sm hover:opacity-80"
                onClick={load}
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="text-sm opacity-80">Sort by</span>

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-xl border px-3 py-2 text-sm bg-transparent"
            >
              <option value="accuracy">Accuracy</option>
              <option value="attempts">Attempts</option>
              <option value="domain">Domain</option>
            </select>

            <select
              value={sortDir}
              onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
              className="rounded-xl border px-3 py-2 text-sm bg-transparent"
            >
              <option value="desc">High → Low</option>
              <option value="asc">Low → High</option>
            </select>

            <span className="text-xs opacity-60">Domains: {rows.length}</span>
          </div>
        </div>

        {/* Empty state */}
        {rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border p-6">
            <p className="text-sm font-semibold">No stats yet</p>
            <p className="mt-2 text-sm opacity-80">
              Complete a quiz and submit answers to generate domain stats.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {rows.map((r) => {
              const accuracy = pct(r.total_correct, r.total_attempts);

              return (
                <div
                  key={r.domain}
                  className="rounded-2xl border p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{r.domain}</p>
                      <p className="mt-1 text-xs opacity-70">
                        Attempts: {r.total_attempts} • Correct: {r.total_correct}
                        {r.last_mode ? ` • Last mode: ${r.last_mode}` : ""}
                      </p>
                    </div>

                    <span className="rounded-full border px-3 py-1 text-xs opacity-80">
                      {accuracy}%
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-4">
                    <div className="h-2 w-full rounded-full border overflow-hidden">
                      <div
                        className="h-full"
                        style={{ width: `${accuracy}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs opacity-70">
                      {r.total_correct}/{r.total_attempts} correct
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer / next steps */}
        <div className="mt-8 text-xs opacity-60">
          Next upgrades: weak domains, streaks, and exam readiness score.
        </div>
      </div>
    </main>
  );
}
