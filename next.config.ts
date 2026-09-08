import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  // The editor is entirely browser-local, so it can be exported as static files.
  output: 'export',
  // GitHub project Pages serves static assets below the repository name.
  assetPrefix: isGitHubPages ? '/FlowBrush' : '',
};

export default nextConfig;
