# Store listings of the web app

Both stores wrap the installed web app, so its address is its identity: list it once it is served from ddalab.org.
The web manifest already carries what the listings read (name, description, categories, icons, a wide and a narrow
screenshot; `packages/ddalab-web/scripts/make-screenshots.mjs` retakes the screenshots).

## Microsoft Store

1. Open a Microsoft Partner Center developer account (individual) and reserve the name DDALAB.
2. On pwabuilder.com, enter `https://ddalab.org/`, choose Package for stores, then Windows, and fill in the
   publisher values Partner Center shows under Product identity.
3. Upload the `.msixbundle` PWABuilder gives you as a new submission, with the screenshots and the privacy URL. DDALAB
   collects nothing: files stay on the device.

## Google Play

1. Open a Google Play developer account (one-time fee). New personal accounts run a closed test with testers for 14
   days before the first production release.
2. Install Bubblewrap (`npm install -g @bubblewrap/cli`), then `bubblewrap init --manifest
   https://ddalab.org/manifest.webmanifest` in an empty folder. Keep the signing key it creates (and its password)
   outside the repository.
3. `bubblewrap build`, and upload `app-release-bundle.aab` in Play Console.
4. Play Console, App integrity, gives the SHA-256 fingerprint of the app signing key. Put it in
   `packages/ddalab-web/public/.well-known/assetlinks.json`, so the app opens without the browser bar:

   ```json
   [{"relation": ["delegate_permission/common.handle_all_urls"],
     "target": {"namespace": "android_app", "package_name": "<the package id from bubblewrap init>",
                "sha256_cert_fingerprints": ["<fingerprint>"]}}]
   ```

   The file must answer at the domain's root: check `https://ddalab.org/.well-known/assetlinks.json` after the deploy.
