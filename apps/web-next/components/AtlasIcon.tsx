// src/components/ui/AtlasIcon.tsx
import { getIconDataUrl } from '@atlas/ui/atlas';

export function getIconAttrs(id: string, size: number = 16) {
  return {
    src: getIconDataUrl(id),
    width: size,
    height: size,
    alt: `${id.replace('tool-', '')} icon`,
    'aria-hidden': 'true'
  };
}

export function AtlasIcon({ id, size, className }: { id: string; size?: number; className?: string }) {
  const attrs = getIconAttrs(id, size);
  return (
    <img 
      {...attrs} 
      className={`${className} brightness-0 invert opacity-80 hover:opacity-100 transition-opacity`} 
    />
  );
}