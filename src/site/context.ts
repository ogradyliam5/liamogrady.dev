export type BuildStats = {
  jsFiles: number;
  jsRawBytes: number;
  jsGzipBytes: number;
  entryGzipBytes: number;
  cssGzipBytes: number;
  htmlGzipBytes?: number;
  dependencies: number;
};

export type BuildContext = {
  dev: boolean;
  builtAt: string;
  git: { sha: string; date: string };
  assets: { mainJs: string; css: string };
  stats: BuildStats;
  /** Every inline <script>/<style> registers its hash here for the CSP. */
  cspHashes: { script: Set<string>; style: Set<string> };
};

export const SITE_URL = 'https://liamogrady.dev';
