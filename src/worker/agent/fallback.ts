/**
 * Deterministic answers for when there is no model (provider "none", errors, Workers AI quota):
 * a short intro plus up to three cited bullets from search(), and UI hints for the top hit.
 */
import { SITE, search, type Chunk, type Hit } from '../../shared/knowledge';
import { firstSentence } from '../text';
import { HIGHLIGHT_TARGETS, NAV_SECTIONS } from './tools';
import type { UiAction } from './types';

export interface FallbackAnswer {
  text: string;
  hits: Hit[];
  ui: { action: UiAction; args: Record<string, unknown> }[];
}

const CV_URL = `${SITE}/#contact`;

/** Page highlight target for a knowledge chunk id (role-x, project-x, cap-x), if there is one. */
export function highlightForChunk(id: string): string | null {
  const m = id.match(/^(role|project|cap)-(.+)$/);
  if (!m) return id === 'certifications' ? (HIGHLIGHT_TARGETS.find((t) => t.startsWith('cert:')) ?? null) : null;
  const target = `${m[1]}:${m[2]}`;
  return HIGHLIGHT_TARGETS.includes(target) ? target : null;
}

export function uiForChunk(chunk: Pick<Chunk, 'id' | 'section'>): FallbackAnswer['ui'] {
  const ui: FallbackAnswer['ui'] = [];
  if ((NAV_SECTIONS as readonly string[]).includes(chunk.section)) ui.push({ action: 'navigate', args: { section: chunk.section } });
  const target = highlightForChunk(chunk.id);
  if (target) ui.push({ action: 'highlight', args: { target } });
  return ui;
}

export function fallbackAnswer(query: string, offlineReason = "The live model isn't available right now, so this comes straight from Liam's public profile."): FallbackAnswer {
  const hits = search(query, 3);
  if (!hits.length) {
    return {
      text: `${offlineReason} I couldn't find anything on that in the profile. Try asking about Liam's experience, projects, certifications or how to get in touch, or request the full CV at ${CV_URL}.`,
      hits,
      ui: [],
    };
  }
  const bullets = hits.map((h) => `- [${h.title}](${h.url}): ${firstSentence(h.text, 200)}`);
  return { text: `${offlineReason}\n\n${bullets.join('\n')}`, hits, ui: uiForChunk(hits[0]!) };
}
