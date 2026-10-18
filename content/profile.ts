/**
 * Single source of truth for everything the site says about Liam.
 *
 * PUBLIC-SAFE CONTENT ONLY. This file feeds the pages, the on-site agent,
 * the MCP server, llms.txt and the terminal CV. Never add client names,
 * project names delivered for clients, user counts, financial outcomes or
 * internal integrations — that detail lives in the private CV, sent on request.
 */

export type Link = { label: string; href: string };

export const person = {
  name: "Liam O'Grady",
  givenName: 'Liam',
  familyName: "O'Grady",
  irishName: 'Liam Ó Grádaigh',
  initials: 'LOG',
  role: 'AI Architect',
  employer: 'Avanade',
  employerUrl: 'https://www.avanade.com/',
  location: 'London, UK',
  origin: 'Galway, Ireland',
  /** First professional role in Microsoft Business Applications. */
  careerStart: '2019-10-01',
  headline: 'I design AI agents that do real work, and I build the tools that make them real.',
  oneLiner:
    "AI Architect at Avanade. Agentic AI on the Microsoft stack: Copilot Studio, Microsoft Foundry, Microsoft 365 Copilot and the Power Platform.",
  summary: [
    "I'm an AI Architect at Avanade in London, working where the Microsoft stack meets AI agents.",
    'For seven years I have designed and delivered enterprise solutions on Dynamics 365 and the Power Platform. For the last few, that has meant agentic AI: Copilot Studio agents, Microsoft Foundry, Microsoft 365 Copilot rollouts and the governance that turns pilots into something an enterprise can trust.',
    'I work from architecture down to code. Alongside client work I build open-source MCP servers and agent tooling for the Microsoft community, using AI coding agents for much of the implementation.',
  ],
  email: 'ogradyliam5@gmail.com',
  links: {
    linkedin: 'https://www.linkedin.com/in/ogradyliam5/',
    github: 'https://github.com/ogradyliam5',
    medium: 'https://medium.com/@ogradyliam5',
    band: 'https://thekingsofconnaught.com/',
  },
} as const;

export type Role = {
  id: string;
  company: string;
  companyUrl?: string;
  parent?: string;
  title: string;
  /** ISO month, e.g. 2026-08 */
  start: string;
  end: string | null;
  place: string;
  summary: string;
  highlights: string[];
  steps?: { title: string; start: string; end: string }[];
  stack: string[];
};

export const experience: Role[] = [
  {
    id: 'avanade',
    company: 'Avanade',
    companyUrl: 'https://www.avanade.com/',
    title: 'AI Architect (Associate Manager)',
    start: '2026-08',
    end: null,
    place: 'London',
    summary:
      "Architecting agentic AI solutions on the Microsoft stack in Avanade's Data & AI practice.",
    highlights: [
      'Solution architecture for agentic AI across Copilot Studio, Microsoft Foundry and Microsoft 365 Copilot.',
      'Shaping reusable patterns, certification paths and enablement for the wider Data & AI team.',
    ],
    stack: ['Copilot Studio', 'Microsoft Foundry', 'Microsoft 365 Copilot', 'Azure', 'Power Platform'],
  },
  {
    id: 'digpacks',
    company: 'DigPacks',
    companyUrl: 'https://www.digpacks.co.uk/',
    title: 'Power Platform AI Solution Architect',
    start: '2025-09',
    end: '2026-08',
    place: 'London',
    summary:
      'Led the AI and Copilot practice: strategy, architecture and governance for safe, scalable agentic AI on the Microsoft stack.',
    highlights: [
      'Set the strategy, architecture and governance model for Copilot Studio and Power Platform AI delivery.',
      'Owned end-to-end design and delivery of Copilot Studio agents across many concurrent engagements.',
      'Built reusable accelerators, design patterns and training to make agentic AI delivery repeatable and compliant.',
      "Started the practice's Microsoft 'in a Day' training and hosted Agent in a Day on behalf of Microsoft.",
    ],
    stack: ['Copilot Studio', 'Power Platform', 'Dataverse', 'Azure', 'ServiceNow integration'],
  },
  {
    id: 'air-partner',
    company: 'Air Partner',
    companyUrl: 'https://www.airpartner.com/en/',
    parent: 'a Wheels Up company',
    title: 'Power Platform Solution Architect',
    start: '2021-08',
    end: '2025-09',
    place: 'London',
    summary:
      'Grew from engineer to solution architect, leading the design, build and deployment of every Dynamics 365 and Power Platform solution in a global aviation business.',
    steps: [
      { title: 'D365 CE & Power Platform Engineer', start: '2021-08', end: '2024-01' },
      { title: 'Senior D365 CE & Power Platform Engineer', start: '2024-01', end: '2025-01' },
      { title: 'Power Platform Solution Architect', start: '2025-01', end: '2025-09' },
    ],
    highlights: [
      'Led the AI transformation: Copilot Studio agents on Microsoft 365 and Teams, AI Builder automations and a Microsoft 365 Copilot readiness and rollout programme.',
      'Architected Dynamics 365 CE and Power Platform solutions through rapid growth and parent-company integration.',
      'Designed a modern ALM process with multi-step approvals, auditing and rollback for every solution deployment.',
      'Led and mentored the engineering and support team, with code review and ALM standards.',
      'Partnered with finance, marketing and operations on licensing, integrations and cross-system data flow.',
    ],
    stack: ['Dynamics 365 CE', 'Copilot Studio', 'AI Builder', 'Power Automate', 'Dataverse', 'C# plug-ins', 'Power BI'],
  },
  {
    id: 'codec',
    company: 'Codec Ireland',
    companyUrl: 'https://www.codec.ie/',
    title: 'CRM Support Consultant',
    start: '2019-10',
    end: '2021-08',
    place: 'Galway',
    summary:
      'Trusted point of contact for large public and private sector customers across the Microsoft Business Applications stack, at a Microsoft Gold Partner.',
    highlights: [
      'Support, administration and customisation across Dynamics 365 CE, Power Apps, Power Automate, Power BI, SQL Server and Azure.',
      'Built and maintained functional solutions to SLA, working directly with senior client stakeholders.',
      'Helped roll out and support a Power Virtual Agents bot in production: my first conversational AI.',
    ],
    stack: ['Dynamics 365 CE', 'Power Apps', 'Power Automate', 'Power Virtual Agents', 'SQL Server'],
  },
];

export const education = {
  institution: 'Atlantic Technological University, Galway',
  qualification: 'BSc (Hons) Business Information Systems',
  start: '2015',
  end: '2019',
  project:
    'Final-year project: an analytics portal for Bluedrop Medical visualising NHS Trust data on the reduction of diabetic amputations, featured in an ATU article.',
  links: [
    { label: 'Bluedrop Medical', href: 'https://bluedropmedical.com/' },
    { label: 'ATU article', href: 'https://atuihubs.ie/702-2/' },
  ] as Link[],
};

export type Certification = {
  id: string;
  name: string;
  short: string;
  level: 'Expert' | 'Associate' | 'Fundamentals' | 'Specialty';
  verifyUrl: string;
};

export const certifications: Certification[] = [
  {
    id: 'agentic-architect',
    name: 'Microsoft Certified: Agentic AI Business Solutions Architect',
    short: 'Agentic AI Business Solutions Architect',
    level: 'Expert',
    verifyUrl:
      'https://learn.microsoft.com/api/credentials/share/en-gb/ogradyliam5/53063758E6261697?sharingId=390193806A6A5E9C',
  },
  {
    id: 'pp-architect',
    name: 'Microsoft Certified: Power Platform Solution Architect Expert',
    short: 'Power Platform Solution Architect',
    level: 'Expert',
    verifyUrl:
      'https://learn.microsoft.com/api/credentials/share/en-us/ogradyliam5/EDF6BEAA2B1CD3F0?sharingId=390193806A6A5E9C',
  },
  {
    id: 'pp-functional',
    name: 'Microsoft Certified: Power Platform Functional Consultant Associate',
    short: 'Power Platform Functional Consultant',
    level: 'Associate',
    verifyUrl:
      'https://learn.microsoft.com/api/credentials/share/en-us/ogradyliam5/8FE0E338A4275A7F?sharingId=390193806A6A5E9C',
  },
  {
    id: 'pp-maker',
    name: 'Microsoft Certified: Power Platform App Maker Associate',
    short: 'Power Platform App Maker',
    level: 'Associate',
    verifyUrl:
      'https://learn.microsoft.com/api/credentials/share/en-us/ogradyliam5/DB090557AA3F5937?sharingId=390193806A6A5E9C',
  },
  {
    id: 'ai-900',
    name: 'Microsoft Certified: Azure AI Fundamentals',
    short: 'Azure AI Fundamentals',
    level: 'Fundamentals',
    verifyUrl: 'https://learn.microsoft.com/en-gb/users/ogradyliam5/credentials/31e6bc9f28ae1048',
  },
];

export type Capability = {
  id: string;
  title: string;
  blurb: string;
  points: string[];
  tools: string[];
};

export const capabilities: Capability[] = [
  {
    id: 'agents',
    title: 'Copilot Studio agents',
    blurb:
      'Production-grade conversational and autonomous agents for whatever the business needs: IT, HR, operations, sales, finance, customer service and the back office.',
    points: [
      'Knowledge-grounded agents over policies, knowledge bases and line-of-business systems',
      'Tool-using agents integrated with ITSM, CRM, ERP and collaboration platforms',
      'Voice-enabled agent patterns for high-volume inbound contact',
      'Hand-off, escalation and human-in-the-loop workflows',
    ],
    tools: ['Copilot Studio', 'Microsoft 365 Copilot', 'Teams', 'Power Automate', 'Dataverse'],
  },
  {
    id: 'architecture',
    title: 'Agentic AI architecture',
    blurb:
      'End-to-end architecture for safe, scalable agentic AI on the Microsoft stack: Copilot Studio, Microsoft Foundry, Azure AI and the Power Platform.',
    points: [
      'Reference architectures and reusable accelerators',
      'Capability models and phased delivery roadmaps',
      'Integration patterns across Microsoft 365, Dynamics 365 and Azure',
      'Cost, performance and observability design',
    ],
    tools: ['Microsoft Foundry', 'Azure OpenAI', 'Azure', 'MCP', 'Microsoft Graph'],
  },
  {
    id: 'governance',
    title: 'AI governance & adoption',
    blurb: 'The guardrails that turn AI pilots into compliant, repeatable enterprise capability.',
    points: [
      'Responsible AI, data residency and compliance reviews',
      'Microsoft 365 Copilot readiness assessments and controlled rollouts',
      'Centre-of-excellence patterns, standards and ALM',
      "Training programmes and Microsoft 'Agent in a Day' enablement",
    ],
    tools: ['Microsoft Purview', 'Power Platform admin', 'Managed Environments', 'CoE Kit'],
  },
  {
    id: 'mcp',
    title: 'MCP servers & agent tooling',
    blurb:
      'Remote MCP servers and agent tooling that plug agents into real systems, from Copilot Studio to ChatGPT, Claude and GitHub Copilot.',
    points: [
      'Zero-dependency MCP servers over Streamable HTTP',
      'OAuth and API-key secured tool surfaces',
      'Computer-use and browser agents with safe, reviewable actions',
      'Coding-agent workflows from issue to reviewed pull request',
    ],
    tools: ['Model Context Protocol', 'TypeScript', 'Node.js', 'GitHub Copilot', 'Cloudflare Workers'],
  },
  {
    id: 'power-platform',
    title: 'Power Platform engineering',
    blurb:
      'Hands-on across the Power Platform: model-driven and code apps, Power Automate, Dataverse, plug-ins and Power BI.',
    points: [
      'Model-driven apps, Dataverse modelling and C# plug-ins',
      'Power Apps code apps in TypeScript',
      'Power Automate flows and AI Builder automations',
      'ALM with pipelines, environments and approvals',
    ],
    tools: ['Power Apps', 'Power Automate', 'Dataverse', 'C#', 'Power Fx', 'Power BI'],
  },
  {
    id: 'dynamics',
    title: 'Dynamics 365 Customer Engagement',
    blurb:
      'Sales, Service and Marketing implementations that move teams from inbox-driven work to managed, measurable processes.',
    points: [
      'Sales, Customer Service and Marketing implementations',
      'Case management, SLAs and queue automation',
      'Real-Time Marketing journeys and integrations',
      'Document generation and process automation',
    ],
    tools: ['Dynamics 365 Sales', 'Customer Service', 'Customer Insights – Journeys'],
  },
];

export const skills: { group: string; items: string[] }[] = [
  {
    group: 'Agentic AI',
    items: ['Copilot Studio', 'Microsoft Foundry', 'Microsoft 365 Copilot', 'AI Builder', 'Model Context Protocol', 'GitHub Copilot', 'OpenAI Codex', 'Claude Code'],
  },
  { group: 'Power Platform', items: ['Power Apps (model-driven & code)', 'Power Automate', 'Power Fx', 'Dataverse', 'C# plug-ins', 'Power BI'] },
  { group: 'Dynamics 365', items: ['Sales', 'Customer Service', 'Marketing'] },
  { group: 'Cloud & data', items: ['Azure', 'SQL Server', 'SharePoint', 'Microsoft Graph', 'Cloudflare'] },
  { group: 'Engineering', items: ['TypeScript', 'JavaScript', 'C#', 'Python', 'ALM & DevOps', 'WebGPU'] },
];

export type Project = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  kind: 'open-source' | 'tool' | 'experiment';
  year: string;
  stack: string[];
  repo?: string;
  live?: string;
  /** Only public projects ship. Private ones stay false until Liam opts in. */
  publish: boolean;
  glyph: 'claw' | 'gauge' | 'server' | 'pulse' | 'plane' | 'grid' | 'drift';
};

export const projects: Project[] = [
  {
    id: 'claw-pc',
    name: 'Claw PC for Copilot Cowork',
    tagline: 'Give Microsoft 365 Copilot a real Windows machine.',
    description:
      'Lets Microsoft 365 Copilot Cowork work on a real Windows PC or VM: commands, PowerShell, files and long-running jobs through a private dev tunnel. One script to start it, one plugin to upload. MCP server, Caddy secret path, dev tunnel and a self-test, all non-admin.',
    kind: 'open-source',
    year: '2026',
    stack: ['TypeScript', 'MCP', 'PowerShell', 'Dev Tunnels', 'Microsoft 365 Copilot'],
    repo: 'https://github.com/ogradyliam5/copilot-cowork-claw-pc',
    publish: true,
    glyph: 'claw',
  },
  {
    id: 'credit-estimator',
    name: 'Copilot Studio Credit Estimator',
    tagline: 'What will this agent cost, before anyone has to ask?',
    description:
      'An interactive, zero-dependency estimator for Copilot Studio credit consumption and cost, modelling the Standard harness and the GitHub Copilot harness side by side, because they are not priced the same way. Built by my engineering agent in the Copilot Studio GitHub Copilot harness.',
    kind: 'tool',
    year: '2026',
    stack: ['JavaScript', 'Zero dependencies', 'Copilot Studio'],
    repo: 'https://github.com/ogradyliam5/copilot-studio-credit-estimator',
    live: 'https://ogradyliam5.github.io/copilot-studio-credit-estimator/',
    publish: true,
    glyph: 'gauge',
  },
  {
    id: 'vercel-mcp',
    name: 'Vercel MCP server for Copilot Studio',
    tagline: 'Let a Copilot Studio agent run your deployments.',
    description:
      'A zero-dependency Node.js MCP server (Streamable HTTP, API-key auth) that lets a Copilot Studio agent inspect Vercel projects and deployments, read build logs and run management actions.',
    kind: 'open-source',
    year: '2026',
    stack: ['Node.js', 'MCP', 'Streamable HTTP', 'Copilot Studio'],
    repo: 'https://github.com/ogradyliam5/vercel-mcp-copilot-studio',
    publish: true,
    glyph: 'server',
  },
  {
    id: 'hevy',
    name: 'Hevy for ChatGPT',
    tagline: 'Talk to your training log.',
    description:
      'An unofficial Hevy integration for ChatGPT and Codex: analyse training, plan routines and safely log workouts through OAuth-enabled MCP tools, with previews and confirmation before every write.',
    kind: 'open-source',
    year: '2026',
    stack: ['MCP', 'OAuth', 'ChatGPT Apps', 'Codex'],
    repo: 'https://github.com/ogradyliam5/hevy-chatgpt-plugin',
    publish: true,
    glyph: 'pulse',
  },
  {
    id: 'auto-checkin',
    name: 'Auto Flight Check-In',
    tagline: 'An AI browser agent that checks you in, for any airline.',
    description:
      'Spots airline booking confirmations in your inbox, extracts the flight with an LLM, waits until check-in opens, then sends a computer-use browser agent to check you in, and emails you the result either way.',
    kind: 'experiment',
    year: '2026',
    stack: ['Python', 'LLM extraction', 'browser-use', 'Docker'],
    repo: 'https://github.com/ogradyliam5/auto-flight-checkin',
    publish: true,
    glyph: 'plane',
  },
  {
    id: 'code-apps-template',
    name: 'Power Apps Code Apps template',
    tagline: 'A TypeScript-first starting point for Power Apps code apps.',
    description:
      'A reusable Power Apps code app template with generic navigation, mock data and TypeScript-first components, so a new authenticated or data-connected app starts from a clean base.',
    kind: 'open-source',
    year: '2025',
    stack: ['TypeScript', 'Vite', 'Power Apps code apps', 'PAC CLI'],
    repo: 'https://github.com/ogradyliam5/PowerApps-Code-Apps-Template',
    publish: true,
    glyph: 'grid',
  },
  {
    id: 'drift-review',
    name: 'Dataverse Drift Review',
    tagline: 'What changed in this environment, and who changed it?',
    description:
      'A work-in-progress XrmToolBox tool that surfaces recent customisation activity in a Dataverse environment.',
    kind: 'experiment',
    year: '2025',
    stack: ['C#', 'XrmToolBox', 'Dataverse'],
    repo: 'https://github.com/ogradyliam5/Dataverse-Drift-Review',
    publish: false,
    glyph: 'drift',
  },
];

export const writing: { title: string; date: string; href: string; summary: string }[] = [
  {
    title: 'Send Teams messages on behalf of your Copilot Studio agent',
    date: '2026-03-02',
    href: 'https://medium.com/@ogradyliam5/send-teams-messages-on-behalf-of-your-copilot-studio-agent-32ed4ec4ddc6',
    summary: 'Proactive 1:1 Teams messages sent as your agent: rollout notices, outage alerts and nudges.',
  },
  {
    title: 'Copilot Studio building blocks: a practical decision tree',
    date: '2026-02-01',
    href: 'https://medium.com/@ogradyliam5/copilot-studio-building-blocks-a-practical-decision-tree-9acfca05097e',
    summary: 'Instructions, topics, tools, knowledge or child agents? Where each requirement should live.',
  },
];

export const music = {
  band: 'The Kings of Connaught',
  bandUrl: 'https://thekingsofconnaught.com/',
  youtube: 'https://www.youtube.com/@thekingsofconnaught',
  role: 'banjo',
  formed: '2012',
  blurb: 'a Galway folk and trad trio.',
};

export const now = {
  updated: '2026-10',
  items: [
    'Architecting agentic AI in the Data & AI practice at Avanade.',
    'Building MCP servers and agent tooling for Copilot Studio and Microsoft 365 Copilot.',
    'Agentic engineering: shipping open-source tools with GitHub Copilot and coding agents.',
  ],
};

export function yearsOfExperience(at: Date = new Date()): number {
  const start = new Date(person.careerStart);
  return Math.floor((at.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000));
}
