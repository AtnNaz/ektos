import type { NextConfig } from "next";

const pages = process.env.EKTOS_PAGES === '1';
const base = pages ? (process.env.EKTOS_BASE_PATH || '').replace(/\/+$/, '') : '';

const env = {
  EKTOS_PAGES: pages ? '1' : '',
  EKTOS_BASE_PATH: base,
  EKTOS_REPO: process.env.GITHUB_REPOSITORY || 'AtnNaz/ektos',
};

const nextConfig: NextConfig = pages
  ? {
      output: 'export',
      basePath: base || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
      pageExtensions: ['tsx', 'ts'],
      agentRules: false,
      env,
    }
  : {
      cacheComponents: true,
      partialPrefetching: true,
      agentRules: false,
      pageExtensions: ['tsx', 'ts', 'server.tsx', 'server.ts'],
      env,
    };

export default nextConfig;
