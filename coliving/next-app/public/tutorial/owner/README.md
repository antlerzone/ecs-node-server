# Tutorial screenshots (Owner / Tenant / Operator)

Screenshots for the **Tutorial** page (`/tutorial`) with tabs: Owner | Tenant | Operator.

**Easiest:** Run from project root to copy from `docs/tutorial/screenshots/` into here and `tenant/`, `operator/`:

```bash
npm run tutorial:copy-screenshots
```

- **owner/** — login.png, portal.png, owner.profile.png, owner.properties.png, owner.agreement.png, owner.report.png, owner.cost.png  
- **tenant/** — tenant-01-login.png … tenant-18-feedback-success.png  
- **operator/** — operator-01-login.png … operator-22-topup-selection.png  

If a file is missing, the tutorial page shows a placeholder `[Screenshot: filename]`. Add images to `docs/tutorial/screenshots/` (see `docs/tutorial/screenshots/SCREENSHOT-LIST.md`) then run the copy script again.
