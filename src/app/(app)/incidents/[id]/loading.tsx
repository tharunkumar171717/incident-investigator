import { Skeleton } from "@/components/ui/misc";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-7 w-96 max-w-full" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
