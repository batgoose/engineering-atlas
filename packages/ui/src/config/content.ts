/**
 * Page Content
 *
 * Structured content for each page
 * Keeps copy consistent across framework implementations
 */

export const homeContent = {
  hero: {
    greeting: 'Software Engineer • 14+ Years',
    headline: 'Jason Booth',
    subhead: 'Engineering Atlas',
    description:
      'A knowledge graph portfolio that visualizes the connections between skills, projects, and experience. Built with Django, Next.js, and a polyglot backend architecture.',
    cta: {
      primary: { label: 'Explore the Atlas', href: '/atlas' },
      secondary: { label: 'View Demos', href: '/demos' },
    },
  },
  sections: {
    skills: {
      title: 'Core Competencies',
      linkText: 'View all in Atlas →',
      linkHref: '/atlas',
    },
    projects: {
      title: 'Featured Projects',
      linkText: 'View all demos →',
      linkHref: '/demos',
    },
    apiMethods: {
      title: 'Data Transmission Methods',
      items: [
        {
          title: 'REST',
          description: 'Django REST Framework with typed serializers',
          status: 'active' as const,
        },
        {
          title: 'GraphQL',
          description: 'Apollo Federation for unified data graph',
          status: 'building' as const,
        },
        {
          title: 'gRPC',
          description: 'Protocol Buffers for microservices',
          status: 'planned' as const,
        },
        {
          title: 'WebSocket',
          description: 'Real-time updates with Go backend',
          status: 'planned' as const,
        },
      ],
    },
  },
};

export const atlasContent = {
  title: 'The Atlas',
  description:
    'An interactive 3D visualization of skills and their connections. Click and drag to rotate, click an icon to explore.',
  filters: {
    label: 'Filter by category',
    clearLabel: 'Clear filter',
  },
};

export const demosContent = {
  title: 'Project Demos',
  description: 'Real-world applications demonstrating technical expertise across the stack.',
  filters: {
    status: ['All', 'Complete', 'In Progress', 'Planned'],
    complexity: ['All', 'Beginner', 'Intermediate', 'Advanced'],
  },
};

export const aboutContent = {
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
};

export const contactContent = {
  title: 'Contact',
  description: "Interested in working together? Let's talk.",
  methods: [
    { type: 'email', label: 'Email', value: 'contact@jasonbooth.dev' },
    { type: 'github', label: 'GitHub', value: 'github.com/batgoose' },
    { type: 'linkedin', label: 'LinkedIn', value: 'linkedin.com/in/jasonbooth' },
  ],
};
