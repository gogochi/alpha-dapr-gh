#!/usr/bin/env sh
set -e
npm run build
cd dist
git init
git checkout -b main
git add -A
git commit -m 'deploy'
# Replace with your GitHub Pages repo URL:
git push -f git@github.com:gogochi/alpha-dapr-gh.git main:gh-pages
echo ""
echo "Build complete! To deploy:"
echo "  cd dist"
echo "  git remote add origin <your-repo-url>"
echo "  git push -f origin main:gh-pages"
cd -
