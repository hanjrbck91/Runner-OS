/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@runner-os/core', '@runner-os/shared', '@runner-os/database'],
  serverExternalPackages: ['pg'],
  webpack(config) {
    // Resolve NodeNext-style ".js" specifiers to their TS sources.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      ...(config.resolve.extensionAlias ?? {}),
    };
    return config;
  },
};

export default nextConfig;
