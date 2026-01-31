/**
 * Icon Registry
 *
 * Maps competency/technology IDs to their icon assets
 * Icons should be SVG files stored in a shared assets folder
 */

export interface IconDefinition {
  id: string;
  name: string;
  iconPath: string; // path to SVG file
  fallbackEmoji?: string; // fallback if icon not available
  category: string;
}

/**
 * Registry of all competency icons
 * Icon paths are relative to assets directory
 *
 * TODO: Update paths to match actual asset locations
 */
export const ICON_REGISTRY: Record<string, IconDefinition> = {
  // Frameworks
  'framework-nextjs': {
    id: 'framework-nextjs',
    name: 'Next.js',
    iconPath: '/icons/nextjs.svg',
    fallbackEmoji: '▲',
    category: 'frontend',
  },
  'lib-react': {
    id: 'lib-react',
    name: 'React',
    iconPath: '/icons/react.svg',
    fallbackEmoji: '⚛️',
    category: 'frontend',
  },
  'framework-angular': {
    id: 'framework-angular',
    name: 'Angular',
    iconPath: '/icons/angular.svg',
    fallbackEmoji: '🅰️',
    category: 'frontend',
  },
  'framework-vue': {
    id: 'framework-vue',
    name: 'Vue',
    iconPath: '/icons/vue.svg',
    fallbackEmoji: '💚',
    category: 'frontend',
  },
  'framework-svelte': {
    id: 'framework-svelte',
    name: 'Svelte',
    iconPath: '/icons/svelte.svg',
    fallbackEmoji: '🔥',
    category: 'frontend',
  },

  // languages
  'lang-typescript': {
    id: 'lang-typescript',
    name: 'TypeScript',
    iconPath: '/icons/typescript.svg',
    fallbackEmoji: '🔷',
    category: 'frontend',
  },
  'lang-python': {
    id: 'lang-python',
    name: 'Python',
    iconPath: '/icons/python.svg',
    fallbackEmoji: '🐍',
    category: 'backend',
  },
  'lang-rust': {
    id: 'lang-rust',
    name: 'Rust',
    iconPath: '/icons/rust.svg',
    fallbackEmoji: '🦀',
    category: 'systems',
  },
  'lang-go': {
    id: 'lang-go',
    name: 'Go',
    iconPath: '/icons/go.svg',
    fallbackEmoji: '🐹',
    category: 'systems',
  },
  'lang-cpp': {
    id: 'lang-cpp',
    name: 'C++',
    iconPath: '/icons/cpp.svg',
    fallbackEmoji: '⚙️',
    category: 'systems',
  },

  // backend
  'framework-django': {
    id: 'framework-django',
    name: 'Django',
    iconPath: '/icons/django.svg',
    fallbackEmoji: '🎸',
    category: 'backend',
  },
  'db-postgres': {
    id: 'db-postgres',
    name: 'PostgreSQL',
    iconPath: '/icons/postgresql.svg',
    fallbackEmoji: '🐘',
    category: 'backend',
  },
  'spec-graphql': {
    id: 'spec-graphql',
    name: 'GraphQL',
    iconPath: '/icons/graphql.svg',
    fallbackEmoji: '◇',
    category: 'backend',
  },

  // devOps
  'tool-docker': {
    id: 'tool-docker',
    name: 'Docker',
    iconPath: '/icons/docker.svg',
    fallbackEmoji: '🐳',
    category: 'devops',
  },
  'cloud-kubernetes': {
    id: 'cloud-kubernetes',
    name: 'Kubernetes',
    iconPath: '/icons/kubernetes.svg',
    fallbackEmoji: '☸️',
    category: 'devops',
  },
  'tool-terraform': {
    id: 'tool-terraform',
    name: 'Terraform',
    iconPath: '/icons/terraform.svg',
    fallbackEmoji: '🏗️',
    category: 'devops',
  },
  'tool-git': {
    id: 'tool-git',
    name: 'Git',
    iconPath: '/icons/git.svg',
    fallbackEmoji: '📦',
    category: 'devops',
  },
};

/**
 * Get icon definition by ID, with fallback
 */
export function getIcon(id: string): IconDefinition {
  return (
    ICON_REGISTRY[id] || {
      id,
      name: id,
      iconPath: '/icons/default.svg',
      fallbackEmoji: '📌',
      category: 'core',
    }
  );
}

/**
 * Get all icons for a category
 */
export function getIconsByCategory(category: string): IconDefinition[] {
  return Object.values(ICON_REGISTRY).filter((icon) => icon.category === category);
}

/**
 * Get all unique categories
 */
export function getCategories(): string[] {
  const categories = new Set(Object.values(ICON_REGISTRY).map((icon) => icon.category));
  return Array.from(categories);
}
