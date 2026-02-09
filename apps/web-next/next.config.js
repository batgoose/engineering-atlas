/** @type {import('next').NextConfig} */
const nextConfig = {
  
  
  transpilePackages: ['@atlas/types', '@atlas/ui', '@atlas/sdk'],
  reactStrictMode: true,
};

module.exports = nextConfig;