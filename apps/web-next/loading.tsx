import { layout, typography } from '@atlas/ui/styles';

export default function Loading() {
  return (
    <div className={`${layout.page} ${layout.flexCenter}`}>
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className={typography.bodyMuted}>Loading...</p>
      </div>
    </div>
  );
}
