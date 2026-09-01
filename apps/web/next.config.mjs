/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@runner-os/core', '@runner-os/shared', '@runner-os/database'],
  // pg: native driver, keep out of the bundler.
  // nodemailer: CJS module (no __esModule); bundling breaks the named
  // `import { createTransport } from "nodemailer"` inside @auth/core, causing
  // "createTransport is not a function" at runtime. Externalize so Next
  // require()s the real CJS module and the export shape is preserved.
  serverExternalPackages: ['pg', 'nodemailer'],
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
