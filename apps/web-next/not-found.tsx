import Link from 'next/link';
import { layout, typography, buttons } from '@atlas/ui/styles';

export default function NotFound() {
  return (
    <div className={`${layout.page} ${layout.flexCenter}`}>
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold text-slate-800 mb-4">404</div>
        <h1 className={`${typography.h2} mb-4`}>Page not found</h1>
        <p className={`${typography.bodyMuted} mb-8`}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/" className={buttons.primary}>
          Back to home
        </Link>
      </div>
    </div>
  );
}
