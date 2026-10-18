/** Tools the on-site agent can call: data tools run here, UI tools are executed by the browser. */
import { z } from 'zod';
import { capabilities, certifications, experience, publishedProjects } from '../../shared/knowledge';
import { PROFILE_SECTIONS } from '../sections';
import type { ToolSpec, UiAction } from './types';

export const NAV_SECTIONS = ['about', 'capabilities', 'work', 'journey', 'credentials', 'writing', 'agents', 'contact'] as const;
export const SCENES = ['swarm', 'roots', 'graph', 'journey', 'signal', 'session'] as const;

/** Every valid highlight target, e.g. project:claw-pc, cert:agentic-architect, role:air-partner, cap:mcp. */
export const HIGHLIGHT_TARGETS: readonly string[] = [
  ...publishedProjects.map((p) => `project:${p.id}`),
  ...certifications.map((c) => `cert:${c.id}`),
  ...experience.map((r) => `role:${r.id}`),
  ...capabilities.map((c) => `cap:${c.id}`),
];

export const UI_TOOLS: ReadonlySet<string> = new Set<UiAction>(['navigate', 'highlight', 'scene', 'open_xray']);
export const MAX_JD = 8000;
export const MAX_PROBLEM = 4000;

export const TOOL_ARGS = {
  search_profile: z.object({ query: z.string().trim().min(1).max(200) }),
  get_section: z.object({ name: z.enum(PROFILE_SECTIONS) }),
  assess_fit: z.object({ job_description: z.string().trim().min(1).max(MAX_JD) }),
  sketch_architecture: z.object({ problem: z.string().trim().min(1).max(MAX_PROBLEM) }),
  navigate: z.object({ section: z.enum(NAV_SECTIONS) }),
  highlight: z.object({ target: z.string().refine((t) => HIGHLIGHT_TARGETS.includes(t), 'unknown target') }),
  scene: z.object({ name: z.enum(SCENES) }),
  open_xray: z.object({}),
} as const;

export type ToolName = keyof typeof TOOL_ARGS;

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_ARGS, name);
}

export function toolKind(name: string): 'data' | 'ui' {
  return UI_TOOLS.has(name) ? 'ui' : 'data';
}

const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: 'search_profile',
    description: "Search Liam's public profile (roles, capabilities, projects, certifications, writing, music). Returns cited snippets.",
    parameters: obj({ query: { type: 'string', maxLength: 200, description: 'What to look up, in a few words.' } }),
  },
  {
    name: 'get_section',
    description: "Read one whole section of Liam's public profile.",
    parameters: obj({ name: { type: 'string', enum: [...PROFILE_SECTIONS] } }),
  },
  {
    name: 'assess_fit',
    description: "Assess how Liam's public profile fits a job description the visitor pasted. Shows a fit card to the visitor.",
    parameters: obj({ job_description: { type: 'string', maxLength: MAX_JD, description: 'The job description, verbatim.' } }),
  },
  {
    name: 'sketch_architecture',
    description: 'Sketch a first-pass Microsoft-stack architecture for a business problem the visitor described. Shows an architecture card.',
    parameters: obj({ problem: { type: 'string', maxLength: MAX_PROBLEM, description: 'The problem, in the visitor’s words.' } }),
  },
  {
    name: 'navigate',
    description: 'Scroll the page to a section that is relevant to the answer.',
    parameters: obj({ section: { type: 'string', enum: [...NAV_SECTIONS] } }),
  },
  {
    name: 'highlight',
    description: 'Highlight the item being discussed on the page.',
    parameters: obj({ target: { type: 'string', enum: [...HIGHLIGHT_TARGETS] } }),
  },
  {
    name: 'scene',
    description: 'Switch the background visual to a scene that matches the topic.',
    parameters: obj({ name: { type: 'string', enum: [...SCENES] } }),
  },
  {
    name: 'open_xray',
    description: 'Open x-ray mode, which shows how this site and agent are built (stack, timings, bundle sizes).',
    parameters: obj({}, []),
  },
];
