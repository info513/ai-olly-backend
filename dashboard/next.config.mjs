/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sprint 1 is a mocked shell; keep the build unblocked by lint/type nits during scaffolding.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
