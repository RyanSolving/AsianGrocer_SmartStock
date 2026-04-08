# Vercel Build Fix TODO

## Plan Steps:
- [x] 1. Update `web-app/package.json`: Upgrade Next.js and eslint-config-next to patched versions
- [x] 2. Update root `package.json`: Remove unnecessary Next.js dependency  
- [x] 3. Run `npm install` in web-app to update package-lock.json
- [x] 4. Test build locally with `npm run build`
- [x] 5. Verify no new errors, ready for Vercel redeploy

**Current Progress:** Build successful! Next.js upgraded to 14.2.35. Push changes to trigger Vercel redeploy.
