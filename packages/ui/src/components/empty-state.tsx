import type { ReactNode } from 'react';
import { cn } from '../utils';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-center', className)}
    >
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
