/**
 * Site Configuration
 *
 * Shared across all framework implementations
 * Navigation structure, metadata, and common content
 */

export interface NavItem {
  label: string;
  href: string;
  description?: string;
}

export interface SiteConfig {
  name: string;
  title: string;
  description: string;
  url: string;
  author: {
    name: string;
    email: string;
    github: string;
    linkedin: string;
  };
  navigation: NavItem[];
}

export const siteConfig: SiteConfig = {
  name: 'Engineering Atlas',
  title: 'Jason Booth | Engineering Atlas',
  description:
    'A knowledge graph portfolio showcasing 14+ years of software engineering expertise across systems programming, web development, and cloud infrastructure.',
  url: 'https://jasonbooth.dev',
  author: {
    name: 'Jason Booth',
    email: 'contact@jasonbooth.dev',
    github: 'https://github.com/batgoose',
    linkedin: 'https://linkedin.com/in/jasonbooth',
  },
  navigation: [
    { label: 'Home', href: '/' },
    { label: 'Atlas', href: '/atlas', description: 'Interactive skill visualization' },
    { label: 'Demos', href: '/demos', description: 'Project showcases' },
    { label: 'About', href: '/about', description: 'Background and experience' },
    { label: 'Contact', href: '/contact', description: 'Get in touch' },
  ],
};

export const frameworks = [
  { id: 'next', name: 'Next.js', path: '/', active: true },
  { id: 'angular', name: 'Angular', path: '/angular', active: false },
  { id: 'vue', name: 'Vue', path: '/vue', active: false },
  { id: 'svelte', name: 'Svelte', path: '/svelte', active: false },
] as const;

export type FrameworkId = (typeof frameworks)[number]['id'];
