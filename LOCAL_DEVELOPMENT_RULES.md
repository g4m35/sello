# Local development rules

## Use this repo only

```text
~/dev/resale-crosslister-clean
```

Under the Cursor workspace `perc 30`, `resale-crosslister` is a **symlink** to that path.

## Do not develop from

```text
~/Desktop/perc 30/resale-crosslister-ARCHIVED-NO-GIT
```

That folder is the old iCloud Desktop checkout (no `.git`). Edits there cannot be pushed and only create drift.

## Before starting work

```bash
cd ~/dev/resale-crosslister-clean
git checkout develop
git pull --ff-only origin develop
git checkout -b <new-branch-name>
```

## Before committing / merging

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Git identity

Must use a GitHub-verified email:

```bash
git config user.email
git config user.name
```

## Deploy

Preview deploys are fine on request. Production (`vercel --prod` / promote `main`) only with explicit owner approval.
