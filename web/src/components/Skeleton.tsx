"use client";

export function CardGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-panel rounded-lg p-4">
          <div className="skeleton w-full aspect-square rounded-md mb-3" />
          <div className="skeleton h-4 w-3/4 rounded mb-2" />
          <div className="skeleton h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

export function RowListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <div className="skeleton w-10 h-10 rounded flex-shrink-0" />
          <div className="flex-1">
            <div className="skeleton h-4 w-1/3 rounded mb-2" />
            <div className="skeleton h-3 w-1/4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DetailHeaderSkeleton() {
  return (
    <div className="flex items-end gap-6 mb-6">
      <div className="skeleton w-40 h-40 rounded-md flex-shrink-0" />
      <div className="flex-1">
        <div className="skeleton h-3 w-16 rounded mb-3" />
        <div className="skeleton h-9 w-2/3 rounded mb-3" />
        <div className="skeleton h-4 w-1/3 rounded" />
      </div>
    </div>
  );
}
