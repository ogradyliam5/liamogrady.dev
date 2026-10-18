/**
 * WebMCP: tools a browser agent can call on this page through document.modelContext.
 * They run in the visitor's browser and read only what is already public here.
 * Registration is best effort and never throws.
 */
type Deps = { open(question?: string): Promise<void> };
type Input = Record<string, unknown>;
type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute(input: Input): Promise<Result>;
};
type ModelContext = { registerTool(tool: Tool, options?: { signal?: AbortSignal }): unknown };
type Section = { title: string; text: string };

const IDS = ['top', 'about', 'capabilities', 'work', 'journey', 'credentials', 'writing', 'agents', 'contact'];
const STOP = new Set('a an and are as at be by does did do for from has have he his how in is it of on or the to was what when where which who why with about can liam liams'.split(' '));
const reply = (text: string, isError = false): Result => ({ content: [{ type: 'text', text }], ...(isError && { isError }) });
const sectionArg = { type: 'string', enum: IDS, description: 'Section id on the home page' };
const schema = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function registerWebMcp(deps: Deps) {
  try {
    const mc = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!('modelContext' in document) || !isSecureContext || typeof mc?.registerTool !== 'function') return;

    // Tell X-ray (if open) that an agent used the page.
    const note = (name: string) => {
      const events = window.__lod?.telemetry.events;
      const detail = `webmcp ${name}`;
      events?.push({ t: Math.round(performance.now()), kind: 'mcp', detail });
      if (events && events.length > 60) events.shift();
      dispatchEvent(new CustomEvent('lod:event', { detail: { kind: 'mcp', detail } }));
    };

    let corpus: Promise<Section[]> | null = null;
    const load = () =>
      (corpus ??= fetch('/llms-full.txt')
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((md) => {
          const out: Section[] = [];
          let parent = '';
          for (const line of md.split('\n')) {
            const h = /^(#{1,3})\s+(.+)/.exec(line);
            if (h) {
              if (h[1]!.length < 3) parent = h[2]!;
              out.push({ title: h[1]!.length < 3 ? h[2]! : `${parent} \u203a ${h[2]}`, text: '' });
            } else if (out.length) out[out.length - 1]!.text += `${line}\n`;
          }
          return out;
        })
        .catch(() => ((corpus = null), [])));

    const search = async (query: string) => {
      const terms = query.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((t) => t.length > 1 && !STOP.has(t));
      if (!terms.length) return reply('Give me a few keywords to search for.');
      const hits = (await load())
        .map((s) => {
          const title = s.title.toLowerCase();
          const text = s.text.toLowerCase();
          return { s, score: terms.reduce((n, t) => n + text.split(t).length - 1 + (title.includes(t) ? 3 : 0), 0) };
        })
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (!hits.length) return reply(`Nothing in the public profile matches \u201c${query}\u201d.`);
      return reply(
        hits
          .map(({ s }) => {
            const lines = s.text.split('\n').filter((l) => l.trim());
            const matching = lines.filter((l) => terms.some((t) => l.toLowerCase().includes(t)));
            return `## ${s.title}\n${(matching.length ? matching : lines).join('\n').slice(0, 600).trim()}`;
          })
          .join('\n\n') + '\n\nSource: https://liamogrady.dev/llms-full.txt',
      );
    };

    const read = async (id: string) => {
      if (!IDS.includes(id)) return reply(`Unknown section. Use one of: ${IDS.join(', ')}.`, true);
      let text = document.getElementById(id)?.innerText;
      if (text === undefined) {
        // Not on the home page: read it from a fresh copy instead.
        const html = await fetch('/').then((r) => r.text());
        text = new DOMParser().parseFromString(html, 'text/html').getElementById(id)?.textContent ?? '';
      }
      text = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*\n\s*/g, '\n\n').trim();
      return reply(text ? text.slice(0, 4000) : 'That section is empty.');
    };

    const navigate = (id: string) => {
      if (!IDS.includes(id)) return reply(`Unknown section. Use one of: ${IDS.join(', ')}.`, true);
      const el = document.getElementById(id);
      if (!el) {
        location.assign(`/#${id}`);
        return reply(`Opening the home page at #${id}.`);
      }
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      return reply(`Scrolled to #${id}.`);
    };

    const tools: Tool[] = [
      {
        name: 'search_profile',
        description: "Search Liam O'Grady's public profile (roles, capabilities, projects, certifications, writing). Returns the three best-matching snippets with their section titles.",
        inputSchema: schema({ query: { type: 'string', description: 'Keywords, e.g. "MCP servers" or "Copilot Studio certification"' } }, ['query']),
        annotations: { readOnlyHint: true },
        execute: async (i) => search(String(i.query ?? '').slice(0, 300)),
      },
      {
        name: 'get_section',
        description: 'Read the text of one section of this page (up to 4,000 characters).',
        inputSchema: schema({ section: sectionArg }, ['section']),
        annotations: { readOnlyHint: true },
        execute: async (i) => read(String(i.section ?? '')),
      },
      {
        name: 'navigate',
        description: 'Scroll the page to a section, so the person you are helping can see it.',
        inputSchema: schema({ section: sectionArg }, ['section']),
        annotations: { readOnlyHint: false },
        execute: async (i) => navigate(String(i.section ?? '')),
      },
      {
        name: 'open_agent',
        description: "Open Liam's own agent on this page, optionally with a first question. Good for a conversation, a fit check against a job description, or an architecture sketch.",
        inputSchema: schema({ question: { type: 'string', description: 'Optional first question for the agent' } }),
        annotations: { readOnlyHint: false },
        execute: async (i) => {
          const q = typeof i.question === 'string' ? i.question.trim().slice(0, 4000) : '';
          await deps.open(q || undefined);
          return reply(q ? "Opened Liam's agent with your question; the answer streams into the panel on the page." : "Opened Liam's agent.");
        },
      },
    ];

    const { signal } = new AbortController();
    for (const tool of tools) {
      const safe: Tool = {
        ...tool,
        execute: async (input) => {
          try {
            note(tool.name);
            return await tool.execute(input && typeof input === 'object' ? input : {});
          } catch {
            return reply('That tool failed; try again.', true);
          }
        },
      };
      try {
        Promise.resolve(mc.registerTool(safe, { signal })).catch(() => {});
      } catch {
        /* one tool failing to register should not stop the others */
      }
    }
  } catch {
    /* WebMCP is an optional extra */
  }
}
