/** @type {import('next').NextConfig} */
const nextConfig = {
  // @libsql/client is a server-only native package — keep it out of the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
