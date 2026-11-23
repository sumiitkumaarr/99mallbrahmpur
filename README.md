# 99 Mall & Aimur Goldmedal

A lightweight billing app with separate 99 Mall and Aimur Goldmedal workspaces.

## Run locally

1. Install dependencies: `npm install`
2. Start the server: `npm start`
3. Open `http://localhost:3000`
4. Enable Email/Password authentication in Firebase.
5. Publish the rules in `firestore.rules` to the `mallbrahmpur` project:
   `firebase deploy --only firestore:rules --project mallbrahmpur`

## Firestore setup

The app connects directly to Firebase from the browser.

- Firebase Authentication handles account creation, login, logout, and password resets.
- Only `sumiitkumar.it@gmail.com` and `amiitkumar.it@gmail.com` are allowed to sign in.
- Firestore stores account records in `accounts/{uid}`.
- Firestore stores sales in the shared `sales` collection. Both allowed email accounts see and add the same bills. On startup, existing sales, expenses, and Goldmedal records are assigned category-specific sequential bill numbers in creation order.
- Use the 99 Mall and Goldmedal buttons in the header to switch workspaces without signing in again. 99 Mall shows its billing, sales, and expenses; Aimur Goldmedal shows its separate Goldmedal bills and reports. The workspaces use the same Firebase project and login but separate Firestore collections.
- Standard bills are validated at ₹99 per item, while manual bills can use any positive whole-rupee amount.
- The 99 Mall “All reports” view includes standard 99 Mall bills, manual bills, and miscellaneous expenses; each type can also be viewed separately.
- Bill numbers use separate atomic sequences: `99BILL-0001`, `MANBILL-0001`, `MISEXPBILL-0001`, and `GOLMEDALBILL-0001`. The per-type counters are stored in `bill_counters`.
- Manual bills require a reason (up to 300 characters); remarks are saved with the bill and shown in the sales table and printed receipt.
- Goldmedal bills use the `goldmedal_sales` collection; their date and time are recorded automatically when saved, and remarks are required.
- Individual bills and expenses can be deleted from Recent Bills, Bills, All Reports, and their respective lists with a confirmation popup followed by the `12345` deletion password.
- Both allowlisted emails can read and write 99 Mall sales, miscellaneous expenses, and Goldmedal bills. Reports remain separated by workspace and collection.
- Changes to `firestore.rules` take effect only after publishing them to the `mallbrahmpur` Firebase project.

## Build and deploy

- Build the static site with `npm run build`; the deployable files are written to `dist/`.
- Vercel builds and publishes the site using `vercel.json` (build command `npm run build`, output directory `dist`). Add the exact Vercel deployment hostname (for example, `your-project.vercel.app`) to Firebase Authentication's authorized domains so sign-in works there.
- Push to `main` to build and deploy the site to GitHub Pages.
- Push a version tag such as `v1.0.0` to deploy that version and create a GitHub Release with generated notes.
- In the repository's **Settings → Pages**, set the source to **GitHub Actions**.
- Add the GitHub Pages hostname to Firebase Authentication's authorized domains. GitHub Pages hosts the browser app only; it does not run the Express server.

To publish a release:

```sh
git tag v1.0.0
git push origin v1.0.0
```
