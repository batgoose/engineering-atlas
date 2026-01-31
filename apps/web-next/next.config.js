/** @type {import('next').NextConfig} */
const nextConfig = {
  // types: for the interfaces/enums
  // ui: for the brand-colors object and any future shared components
  transpilePackages: ['@atlas/types', '@atlas/ui'],
  reactStrictMode: true,
};

module.exports = nextConfig;