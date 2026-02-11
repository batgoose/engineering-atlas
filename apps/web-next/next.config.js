/** @type {import('next').NextConfig} */
const nextConfig = {
  
  
  transpilePackages: ['@atlas/types', '@atlas/ui', '@atlas/sdk', '@atlas/api'],
  reactStrictMode: true,
};

module.exports = nextConfig;
