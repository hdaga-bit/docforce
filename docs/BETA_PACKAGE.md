# Building the v1.4.1 beta package

From the DocForce source tree:

```bash
npm run beta-package
```

That writes a folder next to the repository:

```
DocForce-Beta-v1.4.1/
  mary-docforce-1.4.1.tgz
  QUICKSTART.md
  install-windows.ps1
  install-unix.sh
```

Give testers that folder. They install the tarball into **their** repository
(see QUICKSTART). Scripts never run `npm install -g`.

The folder is gitignored. Recreate it per beta drop.
