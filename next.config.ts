import type { NextConfig } from 'next';
const config: NextConfig = { output: 'standalone', serverExternalPackages: ['snowflake-sdk'], poweredByHeader: false };
export default config;
