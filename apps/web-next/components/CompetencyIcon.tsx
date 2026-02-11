/**
 * Competency Icon Component
 * 
 * Renders SVG icons from the atlas icon registry.
 * Uses data URLs for simplicity - works without dangerouslySetInnerHTML.
 */

import Image from 'next/image';
import { getIconDataUrl, getIconWithSize, hasIcon } from '@atlas/ui/atlas';

interface CompetencyIconProps {
  /** Competency ID (e.g., 'lang-python', 'framework-nextjs') */
  id: string;
  /** Size in pixels (default: 24) */
  size?: number;
  
  className?: string;
  
  alt?: string;
}


export function CompetencyIcon({ id, size = 32 }: { id: string; size?: number }) {
  
  const darkIcons = {
    'lang-rust': { glow: '#ff4d00', brightness: 1.5 },
    'framework-django': { glow: '#00ff41', brightness: 1.4 },
    'framework-astro': { glow: '#ff00ea', brightness: 1.3 },
  };
  
  const config = darkIcons[id as keyof typeof darkIcons];
  const needsBoost = !!config;

  return (
    <div className="relative flex items-center justify-center w-full h-full group/icon">
      {needsBoost && (
        <div 
          className="absolute inset-[-2px] rounded-full blur-[10px] opacity-30 group-hover:opacity-50 transition-opacity duration-500"
          style={{ backgroundColor: config.glow }}
        />
      )}
      
      <Image
        src={getIconDataUrl(id)}
        width={size}
        height={size}
        alt={id}
        unoptimized
        className="relative z-10 transition-transform duration-500 group-hover:scale-110"
        style={
          needsBoost
            ? {
                filter: `brightness(${config.brightness})`,
              }
            : undefined
        }
      />
    </div>
  );
}

/**
 * Inline SVG version for when you need more control (hover states, etc.)
 * Uses dangerouslySetInnerHTML - only use with trusted SVG content
 */
interface InlineIconProps extends CompetencyIconProps {
  /** Custom color (only works with single-color icons) */
  color?: string;
}

export function CompetencyIconInline({
  id,
  size = 24,
  className = '',
  color,
}: InlineIconProps) {
  if (!hasIcon(id)) {
    return (
      <div 
        className={`inline-flex items-center justify-center bg-slate-700 rounded ${className}`}
        style={{ width: size, height: size }}
      >
        <span className="text-xs text-slate-400">?</span>
      </div>
    );
  }

  let svg = getIconWithSize(id, size);
  if (color) {
    svg = svg.replace(/currentColor/g, color);
  }

  return (
    <span
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
