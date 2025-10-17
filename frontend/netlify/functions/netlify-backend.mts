# netlify.toml (root)

[build]
  base    = "frontend"
  command = "npm ci && npm run build"
  publish = "dist"

[functions]
  directory = "frontend/netlify/functions"

[[redirects]]
  from = "/api/*"
  to   = "/.netlify/functions/netlify-backend/:splat"
  status = 200
  force  = true

[[redirects]]
  from = "/*"
  to   = "/index.html"
  status = 200
