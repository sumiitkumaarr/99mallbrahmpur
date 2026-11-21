# 99mallbrahmpur

A lightweight, single-store billing app for a shop where every item costs ₹99.

## Run locally

1. Install dependencies: `npm install`
2. Start the server: `npm start`
3. Open `http://localhost:3000`
4. Enable Email/Password authentication in Firebase.
5. Publish the rules in `firestore.rules`.

## Firestore setup

The app connects directly to Firebase from the browser.

- Firebase Authentication handles account creation, login, logout, and password resets.
- Only `sumiitkumar.it@gmail.com` and `amiitkumar.it@gmail.com` are allowed to sign in.
- Firestore stores account records in `accounts/{uid}`.
- Firestore stores sales in the shared `sales` collection. Both allowed email accounts see, add, and clear the same bills; legacy bills are moved to the shared store ID when the app loads.
- Standard bills are validated at ₹99 per item, while manual bills can use any positive whole-rupee amount.
- Either allowed account can clear all sales from the Sales & reports page; login accounts are preserved.
- Publish the updated `firestore.rules` in Firebase Console after changing access rules.

## Build and deploy

- Build the static site with `npm run build`; the deployable files are written to `dist/`.
- Netlify builds and publishes the site automatically from `main` using `netlify.toml` (build command `npm run build`, publish directory `dist`). Add the Netlify domain (e.g. `99mallbrahmpur.netlify.app`) to Firebase Authentication's authorized domains so sign-in works there.
- Push to `main` to build and deploy the site to GitHub Pages.
- Push a version tag such as `v1.0.0` to deploy that version and create a GitHub Release with generated notes.
- In the repository's **Settings → Pages**, set the source to **GitHub Actions**.
- Add the GitHub Pages hostname to Firebase Authentication's authorized domains. GitHub Pages hosts the browser app only; it does not run the Express server.

To publish a release:

```sh
git tag v1.0.0
git push origin v1.0.0
```
