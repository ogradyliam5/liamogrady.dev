import { minifyHtml } from './html';
import type { BuildContext } from './context';
import { homePage } from './pages/home';
import { cvPage, agentsPage, colophonPage, notFoundPage } from './pages/secondary';

export type { BuildContext } from './context';

export type Route = { file: string; render: (ctx: BuildContext) => string };

const wrap = (fn: (ctx: BuildContext) => string) => (ctx: BuildContext) => (ctx.dev ? fn(ctx) : minifyHtml(fn(ctx)));

export const routes: Route[] = [
  { file: 'index.html', render: wrap(homePage) },
  { file: 'cv/index.html', render: wrap(cvPage) },
  { file: 'agents/index.html', render: wrap(agentsPage) },
  { file: 'colophon/index.html', render: wrap(colophonPage) },
  { file: '404.html', render: wrap(notFoundPage) },
];
