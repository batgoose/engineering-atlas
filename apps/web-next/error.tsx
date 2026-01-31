'use client';

import { useEffect } from 'react';
import { layout, typography, buttons } from '@atlas/ui/styles';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={`${layout.page} ${layout.flexCenter}`}>
      <div className="text-center max-w-md">
        <div className="text-6xl mb-6">⚠️</div>
        <h1 className={`${typography.h2} mb-4`}>Something went wrong</h1>
        <p className={`${typography.bodyMuted} mb-8`}>
          An unexpected error occurred. Please try again.
        </p>
        <button onClick={reset} className={buttons.primary}>
          Try again
        </button>
      </div>
    </div>
  );
}
