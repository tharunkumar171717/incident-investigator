import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm font-semibold">Not found</div>
      <p className="text-sm text-muted">That page or incident does not exist, or you do not have access to it.</p>
      <Link href="/" className="mt-2 text-sm text-accent hover:underline">
        Back to dashboard
      </Link>
    </main>
  );
}
