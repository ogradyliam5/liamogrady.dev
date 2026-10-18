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
  headline: "AI Architect at Avanade, London.",
  oneLiner:
    'AI Architect at Avanade in London. I design and build AI agents with Copilot Studio, Microsoft Foundry, Microsoft 365 Copilot and the Power Platform.',
  summary: [
    "I'm an AI Architect at Avanade in London. I design and build AI agents for organisations on Microsoft 365, mostly with Copilot Studio, Microsoft Foundry and the Power Platform.",
    'Before Avanade I spent nearly seven years on Dynamics 365 and the Power Platform: at a Microsoft partner in Galway, at Air Partner in London, where I went from engineer to solution architect, and leading the AI practice at DigPacks.',
    'I still write code. In my own time I build open-source MCP servers and tools for people working with agents, and I use AI coding agents for a lot of the implementation.',
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
      "Designing AI agent solutions on the Microsoft stack in Avanade's Data & AI practice.",
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
      'Led the AI and Copilot practice: strategy, architecture and governance for Copilot Studio and Power Platform AI work.',
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
      'Support and consultancy for public and private sector customers on Dynamics 365 and the Power Platform, at a Microsoft Gold Partner.',
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
      'Copilot Studio agents for enterprise teams in IT, HR, operations, sales and customer service, connected to the systems and documents people already use.',
    points: [
      'Agents that answer from policies, knowledge bases and business systems',
      'Agents that take actions in ITSM, CRM and ERP systems',
      'Voice agents for busy contact centres',
      'Hand-off to a person when the agent should not decide',
    ],
    tools: ['Copilot Studio', 'Microsoft 365 Copilot', 'Teams', 'Power Automate', 'Dataverse'],
  },
  {
    id: 'architecture',
    title: 'Agent architecture',
    blurb:
      'How agents, data, integrations and security fit together across Copilot Studio, Microsoft Foundry, Azure and the Power Platform.',
    points: [
      'Reference architectures and reusable starting points',
      'Phased roadmaps, from first pilot to wider rollout',
      'Integration with Microsoft 365, Dynamics 365 and Azure',
      'Cost, performance and monitoring',
    ],
    tools: ['Microsoft Foundry', 'Azure OpenAI', 'Azure', 'MCP', 'Microsoft Graph'],
  },
  {
    id: 'governance',
    title: 'AI governance and adoption',
    blurb: 'The policies, controls and training an organisation needs before it can use agents every day.',
    points: [
      'Responsible AI, data residency and compliance reviews',
      'Microsoft 365 Copilot readiness checks and phased rollouts',
      'Centre of excellence standards and ALM',
      "Training, including Microsoft's Agent in a Day",
    ],
    tools: ['Microsoft Purview', 'Power Platform admin', 'Managed Environments', 'CoE Kit'],
  },
  {
    id: 'mcp',
    title: 'MCP servers and agent tools',
    blurb:
      'Servers and tools that connect agents to other systems, for Copilot Studio, ChatGPT, Claude and GitHub Copilot.',
    points: [
      'Remote MCP servers over Streamable HTTP',
      'OAuth and API-key security',
      'Browser agents whose actions can be reviewed',
      'Coding agents that go from an issue to a reviewed pull request',
    ],
    tools: ['Model Context Protocol', 'TypeScript', 'Node.js', 'GitHub Copilot', 'Cloudflare Workers'],
  },
  {
    id: 'power-platform',
    title: 'Power Platform',
    blurb:
      'Model-driven and code apps, Power Automate, Dataverse, C# plug-ins and Power BI.',
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
      'Sales, Customer Service and Marketing implementations, from case management to customer journeys.',
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
    tagline: 'Let Microsoft 365 Copilot Cowork use a Windows PC.',
    description:
      'Lets Microsoft 365 Copilot Cowork run commands, PowerShell, file operations and long jobs on your own Windows PC or VM through a private dev tunnel. One script sets it up and it needs no admin rights.',
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
    tagline: 'Estimate what a Copilot Studio agent will cost.',
    description:
      'A calculator for Copilot Studio credit use and cost. It compares the Standard harness with the GitHub Copilot harness, which are priced differently.',
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
    tagline: 'Manage Vercel deployments from a Copilot Studio agent.',
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
    tagline: 'Use your Hevy workout data in ChatGPT.',
    description:
      'An unofficial Hevy integration for ChatGPT and Codex. It reads your training history, plans routines and logs workouts through MCP tools, and asks for confirmation before it changes anything.',
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
    tagline: 'Automatic airline check-in with a browser agent.',
    description:
      'Finds booking confirmations in your inbox, reads the flight details, waits until check-in opens, then uses a browser agent to check you in and emails you the result.',
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
    tagline: 'A starter template for Power Apps code apps.',
    description:
      'A Power Apps code app template with navigation, mock data and TypeScript components, so a new app starts from a clean base.',
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
    summary: 'How to send one-to-one Teams messages as your agent, for rollout notices, outage alerts and reminders.',
  },
  {
    title: 'Copilot Studio building blocks: a practical decision tree',
    date: '2026-02-01',
    href: 'https://medium.com/@ogradyliam5/copilot-studio-building-blocks-a-practical-decision-tree-9acfca05097e',
    summary: 'When to use instructions, topics, tools, knowledge or child agents in Copilot Studio.',
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
    'Designing AI agent solutions in the Data & AI practice at Avanade.',
    'Building MCP servers and tools for Copilot Studio and Microsoft 365 Copilot.',
    'Building open-source tools with GitHub Copilot and other coding agents.',
  ],
};

export function yearsOfExperience(at: Date = new Date()): number {
  const start = new Date(person.careerStart);
  return Math.floor((at.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000));
}
