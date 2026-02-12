// --- ENUMS & UNIONS ---

export type Proficiency =
  | 'Learning'
  | 'Proficient'
  | 'Advanced'
  | 'Expert'
  | 'Veteran'
  | 'Professional';

export type CompetencyType =
  | 'language'
  | 'framework'
  | 'library'
  | 'infrastructure'
  | 'tooling'
  | 'concept'
  | 'methodology';

export type ArtifactStatus = 'planned' | 'in-progress' | 'complete';

export type ArtifactDomain = 'football' | 'atlas' | 'infrastructure';

export type DemoType =
  | 'code-snippet'
  | 'interactive'
  | 'live-site'
  | 'video'
  | 'case-study'
  | 'visual-asset'
  | 'config'
  | 'schema-def';

export interface CodeReference {
  id: number;
  repository: string;
  file_path: string;
  start_line: number;
  end_line: number | null;
  language: string;
  github_url: string;
  raw_url: string;
  cached_snippet: string;
}

export interface SubCompetency {
  id: string;
  name: string;
  desc: string;
  display_order: number;
  code_references: CodeReference[];
}

export interface CompetencyLink {
  id: string;
  name: string;
  competency_type: CompetencyType;
}

export interface CompetencyHistory {
  role: string;
  company: string;
  year: string;
}

export interface CompetencyNode {
  id: string;
  name: string;

  category: {
    id: string;
    name: string;
    description: string;
    display_order: number;
  };

  competency_type: CompetencyType;
  proficiency: Proficiency;
  summary: string;
  tags: string[];

  sub_competencies: SubCompetency[];
  related_competencies: CompetencyLink[];

  showcase_priority: 'high' | 'medium' | 'low' | 'hidden';
  portfolio_highlight: boolean;

  history: CompetencyHistory[];
}

export interface ArtifactSkill {
  id: string;
  name: string;
  category_name: string;
  role: 'primary' | 'secondary' | 'supporting';
}

export interface Artifact {
  id: string;
  title: string;
  status: ArtifactStatus;
  domain: ArtifactDomain;
  demo_type: DemoType;
  description: string;
  tech_stack: string[];
  repo_url: string;
  live_url: string;
  date_created: string;
  competencies: ArtifactSkill[];
}
