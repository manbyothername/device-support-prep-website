export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl w-full rounded-2xl border p-6">
        <h1 className="text-2xl font-semibold">
          Device Support Certification Prep
        </h1>

        <p className="mt-2 text-sm opacity-80">
          Practice questions by domain. Track your progress. Get exam-ready.
        </p>

        <div className="mt-6 flex gap-3">
          <a
            href="/quiz"
            className="rounded-xl border px-4 py-2 hover:opacity-80"
          >
            Start Quiz
          </a>

          <a
            href="/domains"
            className="rounded-xl border px-4 py-2 hover:opacity-80"
          >
            Browse Domains
          </a>
        </div>
      </div>
    </main>
  );
}
