// packages/types/index.ts

// --- ENUMS & UNIONS ---

// matches PROFICIENCY_CHOICES in Competency model
export type Proficiency =
  | 'Learning'
  | 'Proficient'
  | 'Advanced'
  | 'Expert'
  | 'Veteran'
  | 'Professional';

// matches TYPE_CHOICES in Competency model
export type CompetencyType =
  | 'language'
  | 'framework'
  | 'library'
  | 'infrastructure'
  | 'tooling'
  | 'concept'
  | 'methodology';

// matches STATUS_CHOICES in Artifact model
export type ArtifactStatus = 'planned' | 'in-progress' | 'complete';

// matches COMPLEXITY_CHOICES in Artifact model
export type ArtifactComplexity = 'beginner' | 'intermediate' | 'advanced';

// matches DEMO_TYPE_CHOICES in Artifact model
export type DemoType =
  | 'code-snippet'
  | 'interactive'
  | 'live-site'
  | 'video'
  | 'case-study'
  | 'visual-asset'
  | 'config'
  | 'schema-def';

// --- INTERFACES ---

// matches CommitCodeReferenceSerializer
export interface CodeReference {
  id: number; // django default ID is integer
  repository: string;
  file_path: string;
  start_line: number;
  end_line: number | null;
  language: string;
  github_url: string;
  raw_url: string;
  cached_snippet: string;
}

// matches SubCompetencySerializer
export interface SubCompetency {
  id: string;
  name: string;
  desc: string;
  display_order: number;
  code_references: CodeReference[];
}

// minimal data for related nodes (to prevent recursion)
export interface CompetencyLink {
  id: string;
  name: string;
  competency_type: CompetencyType;
}

// matches the History JSON structure
export interface CompetencyHistory {
  role: string;
  company: string;
  year: string;
}

// matches CompetencySerializer output
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

// --- ARTIFACT TYPES ---

// matches ArtifactCompetencySerializer (flattened for cards)
export interface ArtifactSkill {
  id: string;
  name: string;
  category_name: string;
  role: 'primary' | 'secondary' | 'supporting';
}

// matches ArtifactSerializer
export interface Artifact {
  id: string;
  title: string;
  status: ArtifactStatus;
  complexity: ArtifactComplexity;
  demo_type: DemoType;
  description: string;
  tech_stack: string[]; // array of strings

  repo_url: string;
  live_url: string;

  date_created: string; // ISO Date String

  competencies: ArtifactSkill[]; // the sorted list of badges
}
