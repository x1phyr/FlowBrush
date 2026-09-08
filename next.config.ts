import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  // The editor is entirely browser-local, so it can be exported as static files.
  output: 'export',
  // Project Pages are served below /FlowBrush rather than the domain root.
  basePath: isGitHubPages ? '/FlowBrush' : '',
};

export default nextConfig;
