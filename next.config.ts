import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Minimal deploy bundle for cPanel/VPS: .next/standalone + traced node_modules
  output: 'standalone',

  // Smaller production build
  productionBrowserSourceMaps: false,
  poweredByHeader: false,

  // Keep heavy/native deps out of the webpack server bundle (loaded from node_modules at runtime)
  serverExternalPackages: ['@prisma/client', 'cloudinary'],

  // Prisma query engine binaries are easy to miss in file tracing
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/.prisma/client/**/*',
      './node_modules/@prisma/engines/**/*',
    ],
  },

  // Fewer parallel page workers during build (lowers peak RAM on cPanel build)
  experimental: {
    cpus: 1,
  },
}

export default nextConfig
