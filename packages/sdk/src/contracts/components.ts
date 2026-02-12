export interface LinkProps {
  href: string;
  label: string;
  external?: boolean;
}

export interface BadgeProps {
  label: string;
  variant: 'success' | 'warning' | 'neutral';
}

export interface NavItemProps {
  label: string;
  href: string;
  isActive: boolean;
}

export interface NavigationProps {
  items: NavItemProps[];
  currentPath: string;
  logoText: string;
}

export interface FrameworkOption {
  id: string;
  name: string;
  icon: string;
  path: string;
  active: boolean;
}

export interface FrameworkSwitcherProps {
  frameworks: FrameworkOption[];
  current: FrameworkOption;
  isOpen: boolean;
  onToggle: () => void;
}

export interface HeroProps {
  greeting: string;
  headline: string;
  subhead: string;
  description: string;
  primaryCta: LinkProps;
  secondaryCta: LinkProps;
}

export interface CategoryCardProps {
  name: string;
  description: string;
  competencyCount?: number;
  href: string;
}

export interface ApiMethodCardProps {
  title: string;
  description: string;
  status: 'active' | 'building' | 'planned';
}

export interface HomePageProps {
  hero: HeroProps;
  categories: CategoryCardProps[];
  apiMethods: ApiMethodCardProps[];
  skillsSectionTitle: string;
  skillsSectionLink: LinkProps;
  apiSectionTitle: string;
}

export interface FilterOption {
  id: string;
  label: string;
  isActive: boolean;
}

export interface AtlasPageProps {
  title: string;
  description: string;
  filters: FilterOption[];
  activeFilter: string | null;
  onFilterChange: (filterId: string | null) => void;
}

export interface ProjectCardProps {
  id: string;
  title: string;
  description: string;
  status: 'complete' | 'in-progress' | 'planned';
  complexity: 'beginner' | 'intermediate' | 'advanced';
  techStack: string[];
  repoUrl?: string;
  liveUrl?: string;
  href: string;
}

export interface DemosPageProps {
  title: string;
  description: string;
  statusFilters: FilterOption[];
  complexityFilters: FilterOption[];
  projects: ProjectCardProps[];
  activeStatusFilter: string;
  activeComplexityFilter: string;
}

export interface TimelineEntryProps {
  role: string;
  company: string;
  years: string;
}

export interface AboutSectionProps {
  title: string;
  content: string;
}

export interface AboutPageProps {
  title: string;
  intro: string;
  sections: AboutSectionProps[];
  timeline: TimelineEntryProps[];
  highlights: string[];
}

export interface ContactMethodProps {
  type: 'email' | 'github' | 'linkedin';
  label: string;
  value: string;
  href: string;
  icon: string;
}

export interface ContactPageProps {
  title: string;
  description: string;
  methods: ContactMethodProps[];
  formEnabled: boolean;
}
