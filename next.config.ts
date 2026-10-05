import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["snowflake-sdk"],
  poweredByHeader: false,
};
export default config;
