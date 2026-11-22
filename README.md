# 99 Mall & Aimur Goldmedal

A lightweight billing app with separate 99 Mall and Aimur Goldmedal workspaces.

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
- Firestore stores sales in the shared `sales` collection. Both allowed email accounts see and add the same bills. Existing records are read without a write/migration during startup.
- Use the project selector in the header to switch workspaces without signing in again. 99 Mall shows its billing, sales, and expenses; Aimur Goldmedal shows its separate Goldmedal bills and reports. The workspaces use the same Firebase project and login but separate Firestore collections.
- Standard bills are validated at ₹99 per item, while manual bills can use any positive whole-rupee amount.
- Manual bills require a reason (up to 300 characters); remarks are saved with the bill and shown in the sales table and printed receipt.
- Goldmedal bills use the `goldmedal_sales` collection; their date and time are recorded automatically when saved, and remarks are required.
- Individual 99 Mall and Goldmedal bills can be deleted with a confirmation popup followed by the `12345` deletion password.
- Both allowlisted emails can read and write 99 Mall sales, miscellaneous expenses, and Goldmedal bills. Reports remain separated by workspace and collection.
- Changes to `firestore.rules` take effect only after publishing them to the `mallbrahmpur` Firebase project.

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
