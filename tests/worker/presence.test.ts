import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_BYTES,
  NOTES_PER_SECOND,
  allowInWindow,
  isAttachment,
  normaliseCountry,
  parseClientMessage,
  peerView,
  randomPeerId,
} from '../../src/worker/presence-protocol';

describe('parseClientMessage', () => {
  it('accepts valid moves, notes and pings', () => {
    expect(parseClientMessage('{"t":"m","x":0.5,"y":1,"s":3}')).toEqual({ t: 'm', x: 0.5, y: 1, s: 3 });
    expect(parseClientMessage('{"t":"m","x":0.123456789,"y":0,"s":0}')).toEqual({ t: 'm', x: 0.1235, y: 0, s: 0 });
    expect(parseClientMessage('{"t":"n","n":23}')).toEqual({ t: 'n', n: 23 });
    expect(parseClientMessage('{"t":"p"}')).toEqual({ t: 'p' });
    expect(parseClientMessage('{"t":"p","extra":"ignored"}')).toEqual({ t: 'p' });
  });

  it.each([
    '{"t":"m","x":1.01,"y":0,"s":0}',
    '{"t":"m","x":-0.1,"y":0,"s":0}',
    '{"t":"m","x":0.5,"y":0.5,"s":21}',
    '{"t":"m","x":0.5,"y":0.5,"s":2.5}',
    '{"t":"m","x":"0.5","y":0.5,"s":1}',
    '{"t":"m","x":0.5,"y":0.5}',
    '{"t":"n","n":24}',
    '{"t":"n","n":-1}',
    '{"t":"n","n":"3"}',
    '{"t":"x"}',
    '[1,2]',
    'null',
    'not json',
    '',
  ])('rejects %s', (raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it('ignores oversized and binary frames', () => {
    const padded = JSON.stringify({ t: 'p', pad: 'x'.repeat(MAX_MESSAGE_BYTES) });
    expect(parseClientMessage(padded)).toBeNull();
    const multiByte = JSON.stringify({ t: 'p', pad: 'é'.repeat(300) }); // < 512 chars, > 512 bytes
    expect(multiByte.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(multiByte)).toBeNull();
    expect(parseClientMessage(new TextEncoder().encode('{"t":"p"}').buffer as ArrayBuffer)).toBeNull();
  });
});

describe('note rate limit', () => {
  it(`allows ${NOTES_PER_SECOND} notes a second per socket and drops the rest`, () => {
    let history: number[] = [];
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      const r = allowInWindow(history, 1000 + i * 50, NOTES_PER_SECOND);
      history = r.history;
      results.push(r.ok);
    }
    expect(results.filter(Boolean)).toHaveLength(NOTES_PER_SECOND);
    expect(results.slice(0, NOTES_PER_SECOND).every(Boolean)).toBe(true);
    // A second later the window has moved on.
    expect(allowInWindow(history, 1000 + 11 * 50 + 1000, NOTES_PER_SECOND).ok).toBe(true);
  });
});

describe('peer helpers', () => {
  it('creates 8-character ids', () => {
    expect(randomPeerId(new Uint8Array([0, 1, 2, 3, 35, 36, 37, 255]))).toBe('abcd9abd');
    for (let i = 0; i < 20; i++) expect(randomPeerId()).toMatch(/^[a-z0-9]{8}$/);
  });

  it('normalises countries and never exposes more than id, country and position', () => {
    expect(normaliseCountry('gb')).toBe('GB');
    expect(normaliseCountry('T1')).toBe('XX');
    expect(normaliseCountry(null)).toBe('XX');
    expect(peerView({ id: 'abc', c: 'IE', t: 1, x: 0.5, y: 0.25, s: 2 })).toEqual({ id: 'abc', c: 'IE', x: 0.5, y: 0.25, s: 2 });
    expect(peerView({ id: 'abc', c: 'IE', t: 1 })).toEqual({ id: 'abc', c: 'IE', x: null, y: null, s: null });
    expect(isAttachment({ id: 'a', c: 'GB', t: 1 })).toBe(true);
    expect(isAttachment({ id: 1 })).toBe(false);
    expect(isAttachment(null)).toBe(false);
  });
});
