/* eslint-disable @typescript-eslint/ban-ts-comment */
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";


type Difficulty = "easy" | "medium" | "hard";
type Mode = "balanced" | "exam";

type DbRow = {
  id: string;
  domain: string;
  difficulty: Difficulty;
  mode: Mode;
  question: string;
  choice_a: string;
  choice_b: string;
  choice_c: string;
  choice_d: string;
  correct_choice: "A" | "B" | "C" | "D";
  explanation: string | null;
};

type Question = {
  id: string;
  domain: string;
  difficulty: Difficulty;
  mode: Mode;
  question: string;
  choices: string[];
  correctIndex: number;
  correctChoice: "A" | "B" | "C" | "D";
  explanation: string;
};

function correctChoiceToIndex(c: DbRow["correct_choice"]) {
  return c === "A" ? 0 : c === "B" ? 1 : c === "C" ? 2 : 3;
}

function indexToChoice(i: number): "A" | "B" | "C" | "D" {
  return i === 0 ? "A" : i === 1 ? "B" : i === 2 ? "C" : "D";
}

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Weighted sampling by difficulty.
 * - Takes from buckets according to weight targets, limited by availability.
 * - Fills remainder from leftover pool.
 */
function pickWeighted(questions: Question[], size: number, mode: Mode) {
  const weights =
    mode === "exam"
      ? ({ easy: 0.1, medium: 0.45, hard: 0.45 } as const)
      : ({ easy: 0.3, medium: 0.5, hard: 0.2 } as const);

  const buckets: Record<Difficulty, Question[]> = {
    easy: [],
    medium: [],
    hard: [],
  };

  for (const q of questions) buckets[q.difficulty].push(q);

  // Shuffle each bucket so selection is random but controlled
  buckets.easy = shuffle(buckets.easy);
  buckets.medium = shuffle(buckets.medium);
  buckets.hard = shuffle(buckets.hard);

  const targetEasy = Math.round(size * weights.easy);
  const targetMed = Math.round(size * weights.medium);
  // hard is remainder (avoids rounding drift)
  const targetHard = size - targetEasy - targetMed;

  const takeEasy = Math.min(targetEasy, buckets.easy.length);
  const takeMed = Math.min(targetMed, buckets.medium.length);
  const takeHard = Math.min(targetHard, buckets.hard.length);

  let picked: Question[] = [
    ...buckets.easy.slice(0, takeEasy),
    ...buckets.medium.slice(0, takeMed),
    ...buckets.hard.slice(0, takeHard),
  ];

  // Fill remaining from whatever is left across buckets
  if (picked.length < size) {
    const remainingPool = shuffle([
      ...buckets.easy.slice(takeEasy),
      ...buckets.medium.slice(takeMed),
      ...buckets.hard.slice(takeHard),
    ]);
    picked = picked.concat(remainingPool.slice(0, size - picked.length));
  }

  return shuffle(picked).slice(0, size);
}

export default function QuizPage() {
  const [mode, setMode] = useState<Mode>("balanced");
  const [quizSize, setQuizSize] = useState<5 | 10 | 25 | 50>(25);

  // selected domain (single)
  const [domain, setDomain] = useState<string>("all");

  // dropdown options (many)
  const [domainOptions, setDomainOptions] = useState<string[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<Question[]>([]);
  const total = questions.length;

  const [index, setIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Exam mode lock behavior:
  // - In exam mode, we do NOT reveal correctness/explanation per question.
  const isExamLock = mode === "exam";

  // Score tracking (still tracked even in exam mode, just not displayed per question)
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);

  // Review tracking
  const [incorrectIds, setIncorrectIds] = useState<string[]>([]);
  const [showReview, setShowReview] = useState(false);

  // Session id to group attempts
  const [sessionId, setSessionId] = useState<string>(() => {
    // browser-safe UUID
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? // @ts-ignore
        crypto.randomUUID()
      : `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  });

  const q = useMemo(() => questions[index], [questions, index]);

  const isCorrect =
    !!q && selectedIndex !== null && selectedIndex === q.correctIndex;

  // ---------- C) Persistence helpers ----------

  async function persistAttempt(payload: {
    question_id: string;
    domain: string;
    mode: Mode;
    difficulty: Difficulty;
    selected_choice: "A" | "B" | "C" | "D" | null;
    correct_choice: "A" | "B" | "C" | "D";
    is_correct: boolean | null;
    session_id: string;
  }) {
    // If your app is public/anon, you must allow anon insert via RLS policies.
    // This will fail without policies. We catch and log.
    const { error } = await supabase.from("attempts").insert(payload);
    if (error) {
      console.error("attempts insert failed:", error.message);
    }
  }

  async function upsertDomainStats(payload: {
    domain: string;
    attempts_inc: number;
    correct_inc: number;
    mode: Mode;
  }) {
    // Approach:
    // 1) read existing row
    // 2) upsert with incremented totals
    //
    // If you want true atomic increments, use an RPC function later.
    const { data, error } = await supabase
      .from("domain_stats")
      .select("domain,total_attempts,total_correct")
      .eq("domain", payload.domain)
      .maybeSingle();

    if (error) {
      console.error("domain_stats select failed:", error.message);
      return;
    }

    const prevAttempts = data?.total_attempts ?? 0;
    const prevCorrect = data?.total_correct ?? 0;

    const nextAttempts = prevAttempts + payload.attempts_inc;
    const nextCorrect = prevCorrect + payload.correct_inc;

    const { error: upsertErr } = await supabase.from("domain_stats").upsert(
      {
        domain: payload.domain,
        total_attempts: nextAttempts,
        total_correct: nextCorrect,
        last_mode: payload.mode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "domain" }
    );

    if (upsertErr) {
      console.error("domain_stats upsert failed:", upsertErr.message);
    }
  }

  // ---------- Domain dropdown: load once ----------
  useEffect(() => {
    async function loadDomainOptions() {
      setDomainsLoading(true);

      const { data, error } = await supabase.from("questions").select("domain");
      if (error) {
        console.error("Error loading domains:", error.message);
        setDomainsLoading(false);
        return;
      }

      const unique = Array.from(
        new Set((data ?? []).map((r: { domain: string }) => r.domain))
      )
        .filter(Boolean)
        .sort();

      setDomainOptions(unique);

      // if selection no longer exists, reset
      if (domain !== "all" && !unique.includes(domain)) setDomain("all");

      setDomainsLoading(false);
    }

    loadDomainOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Load questions (mode + domain) ----------
  async function loadQuestions(selectedMode: Mode) {
    setLoading(true);
    setError(null);

    let query = supabase
      .from("questions")
      .select(
        "id,domain,difficulty,mode,question,choice_a,choice_b,choice_c,choice_d,correct_choice,explanation"
      )
      .eq("mode", selectedMode);

    if (domain !== "all") query = query.eq("domain", domain);

    const { data, error } = await query.limit(500);

    if (error) {
      setError(error.message);
      setQuestions([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as DbRow[];

    const mapped: Question[] = rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      difficulty: r.difficulty,
      mode: r.mode,
      question: r.question,
      choices: [r.choice_a, r.choice_b, r.choice_c, r.choice_d],
      correctIndex: correctChoiceToIndex(r.correct_choice),
      correctChoice: r.correct_choice,
      explanation: r.explanation ?? "No explanation provided.",
    }));

    // B) Difficulty weighting
    const picked = pickWeighted(mapped, clampInt(quizSize, 1, 500), selectedMode);

    setQuestions(picked);

    // reset quiz state
    setIndex(0);
    setSelectedIndex(null);
    setSubmitted(false);
    setCorrectCount(0);
    setAnsweredCount(0);
    setIncorrectIds([]);
    setShowReview(false);

    // new session each reload (so attempts grouped)
    // @ts-ignore
    const newSess =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? // @ts-ignore
          crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setSessionId(newSess);

    setLoading(false);
  }

  useEffect(() => {
    loadQuestions(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, quizSize, domain]);

  // ---------- Actions ----------
  async function submit() {
    if (!q || selectedIndex === null || submitted) return;

    setSubmitted(true);
    setAnsweredCount((n) => n + 1);

    const chosen = indexToChoice(selectedIndex);
    const correct = q.correctChoice;
    const correctBool = chosen === correct;

    if (correctBool) {
      setCorrectCount((n) => n + 1);
    } else {
      setIncorrectIds((prev) => (prev.includes(q.id) ? prev : [...prev, q.id]));
    }

    // C) Persist attempt + update per-domain stats
    setSaving(true);
    try {
      await persistAttempt({
        question_id: q.id,
        domain: q.domain,
        mode,
        difficulty: q.difficulty,
        selected_choice: chosen,
        correct_choice: correct,
        is_correct: correctBool,
        session_id: sessionId,
      });

      await upsertDomainStats({
        domain: q.domain,
        attempts_inc: 1,
        correct_inc: correctBool ? 1 : 0,
        mode,
      });
    } finally {
      setSaving(false);
    }

    // Exam lock: allow user to proceed, but no feedback shown here
    if (index === total - 1) {
      setShowReview(true);
    }
  }

  function next() {
    if (!submitted) return;

    if (index < total - 1) {
      setIndex((i) => i + 1);
      setSelectedIndex(null);
      setSubmitted(false);
    } else {
      setShowReview(true);
    }
  }

  function restartQuizKeepQuestions() {
    setIndex(0);
    setSelectedIndex(null);
    setSubmitted(false);
    setCorrectCount(0);
    setAnsweredCount(0);
    setIncorrectIds([]);
    setShowReview(false);

    // new session for restarted run
    // @ts-ignore
    const newSess =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? // @ts-ignore
          crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setSessionId(newSess);
  }

  function reshuffle() {
    setQuestions((prev) => shuffle(prev));
    restartQuizKeepQuestions();
  }

  function retryIncorrectOnly() {
    const missedSet = new Set(incorrectIds);
    const filtered = questions.filter((qq) => missedSet.has(qq.id));

    setQuestions(shuffle(filtered));
    setIndex(0);
    setSelectedIndex(null);
    setSubmitted(false);
    setCorrectCount(0);
    setAnsweredCount(0);
    setIncorrectIds([]);
    setShowReview(false);

    // new session for retry run
    // @ts-ignore
    const newSess =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? // @ts-ignore
          crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setSessionId(newSess);
  }

  const progressPct = total ? Math.round(((index + 1) / total) * 100) : 0;

  // ---------- UI States ----------
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-2xl border p-6">
          <p className="text-sm opacity-80">Loading quiz…</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-2xl border p-6">
          <p className="text-sm font-semibold">Couldn’t load questions</p>
          <p className="mt-2 text-sm opacity-80">{error}</p>
        </div>
      </main>
    );
  }

  if (!q) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-2xl border p-6">
          <p className="text-sm font-semibold">No questions found</p>
          <p className="mt-2 text-sm opacity-80">
            Check your table rows for mode = {mode}
            {domain !== "all" ? ` and domain = ${domain}` : ""}.
          </p>
        </div>
      </main>
    );
  }

  // ---------- Review Screen ----------
  if (showReview) {
    const missed = questions.filter((qq) => incorrectIds.includes(qq.id));

    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-2xl w-full rounded-2xl border p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">
                {mode === "exam" ? "Exam Results" : "Review"}
              </h1>
              <p className="mt-2 text-sm opacity-80">
                Final score: {correctCount}/{total}
              </p>
              <p className="mt-1 text-xs opacity-70">
                Mode: {mode.toUpperCase()}
                {domain !== "all" ? ` • Domain: ${domain}` : ""}
              </p>
            </div>

            <span className="rounded-full border px-3 py-1 text-xs opacity-80">
              Missed {missed.length}
            </span>
          </div>

          <div className="mt-4 rounded-xl border p-4 bg-white/5">
            {missed.length === 0 ? (
              <p className="text-sm opacity-80">Perfect run. No misses.</p>
            ) : (
              <ul className="space-y-2">
                {missed.map((m, i) => (
                  <li key={m.id}>
                    <button
                      className="w-full text-left rounded-xl border px-4 py-3 hover:opacity-90 transition"
                      onClick={() => {
                        const idx = questions.findIndex((qq) => qq.id === m.id);
                        setShowReview(false);
                        setIndex(idx);
                        setSelectedIndex(null);
                        setSubmitted(false);
                      }}
                    >
                      <p className="text-xs opacity-70">
                        {m.domain} • {m.difficulty.toUpperCase()}
                      </p>
                      <p className="mt-1">
                        {i + 1}. {m.question}
                      </p>

                      {/* In exam mode, reveal the correct answer in review */}
                      <p className="mt-2 text-xs opacity-80">
                        Correct:{" "}
                        <span className="font-semibold">
                          {indexToChoice(m.correctIndex)}
                        </span>{" "}
                        • {m.choices[m.correctIndex]}
                      </p>

                      <p className="mt-2 text-xs opacity-70">{m.explanation}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-xl border px-4 py-2 hover:opacity-80"
              onClick={restartQuizKeepQuestions}
            >
              Restart full quiz
            </button>

            <button
              className="rounded-xl border px-4 py-2 hover:opacity-80 disabled:opacity-40"
              disabled={incorrectIds.length === 0}
              onClick={retryIncorrectOnly}
            >
              Retry incorrect only
            </button>

            <button
              className="rounded-xl border px-4 py-2 hover:opacity-80"
              onClick={() => setShowReview(false)}
            >
              Back to quiz
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ---------- Main Quiz UI ----------
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-2xl w-full rounded-2xl border p-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 items-center">
            <button
              className={`rounded-xl border px-4 py-2 hover:opacity-80 ${
                mode === "balanced" ? "font-semibold" : ""
              }`}
              onClick={() => setMode("balanced")}
            >
              Balanced
            </button>

            <button
              className={`rounded-xl border px-4 py-2 hover:opacity-80 ${
                mode === "exam" ? "font-semibold" : ""
              }`}
              onClick={() => setMode("exam")}
              title="Exam mode hides feedback until the end"
            >
              Exam
            </button>

            <span className="mx-1 opacity-40">|</span>

            {[5, 10, 25, 50].map((n) => (
              <button
                key={n}
                className={`rounded-xl border px-3 py-2 text-sm hover:opacity-80 ${
                  quizSize === n ? "font-semibold" : ""
                }`}
                onClick={() => setQuizSize(n as 5 | 10 | 25 | 50)}
                title={`Start a ${n}-question session`}
              >
                {n}
              </button>
            ))}

            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm bg-transparent"
              title="Filter by domain"
            >
              <option value="all">
                {domainsLoading ? "Loading domains..." : "All Domains"}
              </option>

              {domainOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {saving && (
              <span className="rounded-full border px-3 py-1 text-xs opacity-80">
                Saving…
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border px-3 py-1 text-xs opacity-80">
              Loaded {total}
            </span>

            <span className="rounded-full border px-3 py-1 text-xs opacity-80">
              Score {correctCount}/{answeredCount}
            </span>
          </div>
        </div>

        {/* Header */}
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs opacity-70">
              Question {index + 1} of {total} • {q.domain}
            </p>
            <h1 className="mt-2 text-xl font-semibold">{q.question}</h1>
          </div>

          <span className="rounded-full border px-3 py-1 text-xs opacity-80">
            {q.difficulty.toUpperCase()}
          </span>
        </div>

        {/* Progress */}
        <div className="mt-4">
          <div className="h-2 w-full rounded-full border overflow-hidden">
            <div className="h-full" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1 text-xs opacity-70">{progressPct}%</p>
        </div>

        {/* Choices */}
        <div className="mt-6 grid gap-3">
          {q.choices.map((choice, idx) => {
            const isSelected = selectedIndex === idx;
            const isCorrectChoice = idx === q.correctIndex;

            // A) Exam mode lock: do not show correctness per question
            const showCorrect = !isExamLock && submitted && isCorrectChoice;
            const showWrong = !isExamLock && submitted && isSelected && !isCorrect;

            let className =
              "rounded-xl border px-4 py-3 text-left transition select-none";

            if (!submitted) className += " hover:opacity-90";

            if (!submitted && isSelected) className += " ring-2 ring-offset-2";

            if (!isExamLock && submitted) {
              if (showCorrect) className += " border-green-500/70 bg-green-500/10";
              else if (showWrong) className += " border-red-500/70 bg-red-500/10";
              else className += " opacity-70";
            } else if (isExamLock && submitted) {
              // in exam mode, just dim all after submit (no reveal)
              className += " opacity-80";
            }

            return (
              <button
                key={idx}
                type="button"
                className={className}
                disabled={submitted}
                onClick={() => {
                  if (submitted) return;
                  setSelectedIndex(idx);
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs opacity-80">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span>{choice}</span>
                  </div>

                  {!isExamLock && submitted && showCorrect && (
                    <span className="text-xs font-semibold text-green-400">
                      Correct
                    </span>
                  )}
                  {!isExamLock && submitted && showWrong && (
                    <span className="text-xs font-semibold text-red-400">
                      Incorrect
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-xl border px-4 py-2 hover:opacity-80 disabled:opacity-40"
            disabled={selectedIndex === null || submitted}
            onClick={submit}
          >
            Submit
          </button>

          <button
            className="rounded-xl border px-4 py-2 hover:opacity-80 disabled:opacity-40"
            disabled={!submitted}
            onClick={next}
          >
            {index < total - 1 ? "Next" : "Finish"}
          </button>

          <button
            className="rounded-xl border px-4 py-2 hover:opacity-80"
            onClick={reshuffle}
            title="Shuffle the current loaded set"
          >
            Reshuffle
          </button>

          <button
            className="rounded-xl border px-4 py-2 hover:opacity-80"
            onClick={() => loadQuestions(mode)}
            title="Reload from database"
          >
            Reload from DB
          </button>
        </div>

        {/* Explanation (hidden in Exam mode until review) */}
        {submitted && !isExamLock && (
          <div className="mt-6 rounded-xl border p-4 bg-white/5">
            <p className="text-sm font-semibold">
              {isCorrect ? "✅ Correct" : "❌ Incorrect"}
            </p>
            <p className="mt-2 text-sm opacity-80">{q.explanation}</p>
          </div>
        )}

        {/* Exam mode hint */}
        {submitted && isExamLock && (
          <div className="mt-6 rounded-xl border p-4 bg-white/5">
            <p className="text-sm opacity-80">
              Exam mode: feedback is shown at the end.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
