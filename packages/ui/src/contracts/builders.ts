/**
 * Data Builders
 *
 * Functions that transform raw content/API data into component props
 * Used by all framework implementations to ensure consistent data shapes
 */

import type {
  HomePageProps,
  HeroProps,
  CategoryCardProps,
  ApiMethodCardProps,
  AtlasPageProps,
  FilterOption,
  DemosPageProps,
  ProjectCardProps,
  AboutPageProps,
  TimelineEntryProps,
  ContactPageProps,
  ContactMethodProps,
  NavigationProps,
  NavItemProps,
  FrameworkOption,
} from './components';

// ============================================================
// NAVIGATION
// ============================================================

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Atlas', href: '/atlas' },
  { label: 'Demos', href: '/demos' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

export function buildNavigation(currentPath: string): NavigationProps {
  const items: NavItemProps[] = NAV_ITEMS.map((item) => ({
    ...item,
    isActive: currentPath === item.href,
  }));

  return {
    items,
    currentPath,
    logoText: 'Atlas',
  };
}

export function getFrameworkOptions(): FrameworkOption[] {
  return [
    { id: 'next', name: 'Next.js', icon: '▲', path: '/', active: true },
    { id: 'angular', name: 'Angular', icon: 'A', path: '/angular', active: false },
    { id: 'vue', name: 'Vue', icon: 'V', path: '/vue', active: false },
    { id: 'svelte', name: 'Svelte', icon: 'S', path: '/svelte', active: false },
  ];
}

// ============================================================
// HOME PAGE
// ============================================================

export function buildHomePageProps(): HomePageProps {
  const hero: HeroProps = {
    greeting: 'Software Engineer • 14+ Years',
    headline: 'Jason Booth',
    subhead: 'Engineering Atlas',
    description:
      'A knowledge graph portfolio that visualizes the connections between skills, projects, and experience. Built with Django, Next.js, and a polyglot backend architecture.',
    primaryCta: { href: '/atlas', label: 'Explore the Atlas' },
    secondaryCta: { href: '/demos', label: 'View Demos' },
  };

  const categories: CategoryCardProps[] = [
    {
      name: 'Frontend',
      description: 'React, Vue, Angular, Svelte, TypeScript',
      href: '/atlas?filter=frontend',
    },
    {
      name: 'Backend',
      description: 'Django, Python, PostgreSQL, GraphQL',
      href: '/atlas?filter=backend',
    },
    {
      name: 'Systems',
      description: 'C++, Rust, Go, embedded programming',
      href: '/atlas?filter=systems',
    },
    {
      name: 'DevOps',
      description: 'Docker, Kubernetes, Terraform, CI/CD',
      href: '/atlas?filter=devops',
    },
    { name: 'Data', description: 'SQL, ETL pipelines, analytics', href: '/atlas?filter=data' },
    {
      name: 'Security',
      description: 'Penetration testing, secure architecture',
      href: '/atlas?filter=security',
    },
  ];

  const apiMethods: ApiMethodCardProps[] = [
    {
      title: 'REST',
      description: 'Django REST Framework with typed serializers',
      status: 'active',
    },
    {
      title: 'GraphQL',
      description: 'Apollo Federation for unified data graph',
      status: 'building',
    },
    { title: 'gRPC', description: 'Protocol Buffers for microservices', status: 'planned' },
    { title: 'WebSocket', description: 'Real-time updates with Go backend', status: 'planned' },
  ];

  return {
    hero,
    categories,
    apiMethods,
    skillsSectionTitle: 'Core Competencies',
    skillsSectionLink: { href: '/atlas', label: 'View all in Atlas →' },
    apiSectionTitle: 'Data Transmission Methods',
  };
}

// ============================================================
// ATLAS PAGE
// ============================================================

const ATLAS_CATEGORIES = ['All', 'Frontend', 'Backend', 'Systems', 'DevOps', 'Data', 'Security'];

export function buildAtlasPageProps(activeFilter: string | null): AtlasPageProps {
  const filters: FilterOption[] = ATLAS_CATEGORIES.map((cat) => ({
    id: cat.toLowerCase(),
    label: cat,
    isActive: activeFilter === cat.toLowerCase() || (cat === 'All' && !activeFilter),
  }));

  return {
    title: 'The Atlas',
    description:
      'Interactive 3D sphere visualization. Click and drag to rotate. Click an icon to explore.',
    filters,
    activeFilter,
    onFilterChange: () => {}, // Implemented by framework
  };
}

// ============================================================
// DEMOS PAGE
// ============================================================

const STATUS_OPTIONS = ['All', 'Complete', 'In Progress', 'Planned'];
const COMPLEXITY_OPTIONS = ['All', 'Beginner', 'Intermediate', 'Advanced'];

// Placeholder projects - will come from API
const PLACEHOLDER_PROJECTS: ProjectCardProps[] = [
  {
    id: 'demo-cpp-win-prob',
    title: 'NFL Win Probability Engine',
    description: 'A high-performance C++ simulation engine using Monte Carlo methods.',
    status: 'complete',
    complexity: 'advanced',
    techStack: ['C++20', 'GTest', 'CMake'],
    repoUrl: 'https://github.com/batgoose/engineering-atlas',
    href: '/demos/demo-cpp-win-prob',
  },
  {
    id: 'demo-rust-parser',
    title: 'nflverse Data Ingestion',
    description: 'Memory-safe CLI tool for parsing massive CSV dumps.',
    status: 'in-progress',
    complexity: 'advanced',
    techStack: ['Rust', 'Serde', 'Tokio', 'Postgres'],
    repoUrl: 'https://github.com/batgoose/engineering-atlas',
    href: '/demos/demo-rust-parser',
  },
  {
    id: 'demo-django-api',
    title: 'The League API',
    description: 'Central API Gateway with efficient ORM usage.',
    status: 'complete',
    complexity: 'advanced',
    techStack: ['Django', 'DRF', 'Postgres', 'Redis'],
    repoUrl: 'https://github.com/batgoose/engineering-atlas',
    liveUrl: 'https://api.batgoose.com/docs',
    href: '/demos/demo-django-api',
  },
  {
    id: 'demo-react-draft',
    title: 'Live Fantasy Draft Board',
    description: 'Drag-and-drop draft board with complex state management.',
    status: 'in-progress',
    complexity: 'intermediate',
    techStack: ['React', 'TypeScript', 'Tailwind'],
    href: '/demos/demo-react-draft',
  },
];

export function buildDemosPageProps(
  activeStatus: string = 'all',
  activeComplexity: string = 'all'
): DemosPageProps {
  const statusFilters: FilterOption[] = STATUS_OPTIONS.map((s) => ({
    id: s.toLowerCase().replace(' ', '-'),
    label: s,
    isActive: activeStatus === s.toLowerCase().replace(' ', '-'),
  }));

  const complexityFilters: FilterOption[] = COMPLEXITY_OPTIONS.map((c) => ({
    id: c.toLowerCase(),
    label: c,
    isActive: activeComplexity === c.toLowerCase(),
  }));

  // Filter projects based on active filters
  let filteredProjects = PLACEHOLDER_PROJECTS;
  if (activeStatus !== 'all') {
    filteredProjects = filteredProjects.filter((p) => p.status === activeStatus);
  }
  if (activeComplexity !== 'all') {
    filteredProjects = filteredProjects.filter((p) => p.complexity === activeComplexity);
  }

  return {
    title: 'Project Demos',
    description: 'Real-world applications demonstrating technical expertise across the stack.',
    statusFilters,
    complexityFilters,
    projects: filteredProjects,
    activeStatusFilter: activeStatus,
    activeComplexityFilter: activeComplexity,
  };
}

// ============================================================
// ABOUT PAGE
// ============================================================

export function buildAboutPageProps(): AboutPageProps {
  const timeline: TimelineEntryProps[] = [
    { role: 'Lead Software Engineer', company: 'Black Lantern Security', years: '2023–Present' },
    { role: 'Software Engineer', company: 'Mechdyne', years: '2021–2023' },
    { role: 'Embedded Engineer', company: 'Gridpoint', years: '2013–2016' },
  ];

  return {
    title: 'About',
    intro:
      "I'm Jason Booth, a software engineer with 14+ years of experience building systems that scale.",
    sections: [
      {
        title: 'Background',
        content:
          "From embedded systems to cloud architecture, I've worked across the stack. My focus is on writing clean, maintainable code that solves real problems.",
      },
      {
        title: 'Current Focus',
        content:
          'Building full-stack applications with Django and Next.js, with a growing interest in Rust for performance-critical systems.',
      },
      {
        title: 'This Project',
        content:
          'The Engineering Atlas is both a portfolio and a technical demonstration. It showcases not just what I know, but how I think about software architecture.',
      },
    ],
    timeline,
    highlights: [
      'Django REST Framework with typed serializers',
      'Multiple frontend frameworks sharing design tokens',
      'Polyglot microservices (Python, Go, Rust, C++)',
      'Infrastructure as Code with Terraform and Kubernetes',
    ],
  };
}

// ============================================================
// CONTACT PAGE
// ============================================================

export function buildContactPageProps(): ContactPageProps {
  const methods: ContactMethodProps[] = [
    {
      type: 'email',
      label: 'Email',
      value: 'contact@jasonbooth.dev',
      href: 'mailto:contact@jasonbooth.dev',
      icon: '✉️',
    },
    {
      type: 'github',
      label: 'GitHub',
      value: 'github.com/batgoose',
      href: 'https://github.com/batgoose',
      icon: '🐙',
    },
    {
      type: 'linkedin',
      label: 'LinkedIn',
      value: 'linkedin.com/in/jasonbooth',
      href: 'https://linkedin.com/in/jasonbooth',
      icon: '💼',
    },
  ];

  return {
    title: 'Contact',
    description: "Interested in working together? Let's talk.",
    methods,
    formEnabled: false, // set true when form backend is ready
  };
}
