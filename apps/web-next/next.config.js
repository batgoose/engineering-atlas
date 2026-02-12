const path = require('path');

const alias = {
  '@': path.resolve(__dirname),
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@atlas/types', '@atlas/ui', '@atlas/sdk', '@atlas/api'],
  reactStrictMode: true,
  experimental: {
    turbo: {
      resolveAlias: alias,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      ...alias,
    };
    return config;
  },
};

module.exports = nextConfig;
