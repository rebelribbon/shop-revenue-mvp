# Preview rollout from protected main

The reviewed business-type workspace and canonical-domain changes are merged into main. Production remains manual and gated.

Preview deployments now run only for pushes to protected main, after both browser checks and the preview CI job succeed. The existing staging environment supplies deployment credentials. The job verifies the preview Supabase project before migrating, applies the forward-only migration chain, verifies RLS, builds/deploys, checks the exact deployment, and updates the stable preview alias. It never promotes a production deployment.

Repository owner setup: protect main, require pull requests and the test/e2e status checks, and block force pushes/deletion. The GitHub connector does not have administration permissions to create this rule. Confirm the branch's protected flag before merging the rollout PR. Do not remove the protected-branch condition to make deployment run.

The stable preview remains https://shop-revenue-m4-preview-brads-projects-3548d304.vercel.app. Production remains https://www.shoprevenue.app and uses its own credentials and database.

After the rollout PR is merged into protected main, verify the preview migration, deployment and exact-commit health check. Owners select the workspace in Settings → Business profile. Existing tenants retain automotive as their default until they choose a business type.
