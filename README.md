# Sliding Scale

Sliding Scale is a free, open-source insulin dose calculator designed to make personal sliding-scale dosing easier to reference.

It is a small Progressive Web App (PWA): installable on mobile, fast to open, and usable without an account.

> **Medical note:** This app does not provide medical advice. It only calculates a dose from the sliding scale a user enters. Always follow instructions from a licensed clinician.

## What this app is for

This app helps someone quickly answer:

> “Given my current blood glucose reading, how many insulin units does my sliding scale say I should take?”

The app lets users:

- Enter a blood glucose value
- See the matching insulin dose immediately
- Set their own sliding scale during onboarding
- Edit their scale later from settings
- Save settings locally on-device
- Automatically keep optional local history of readings and doses
- View history over time with a simple graph
- Download/upload settings as JSON

## Who it is designed for

Sliding Scale is designed for people who already have a clinician-provided insulin sliding scale and want a simple personal tool to reference it.

It is especially useful for:

- People who use correction-dose or sliding-scale insulin
- People who want a fast mobile-first calculator
- People who prefer a private, local-first app with no account
- Caregivers helping someone follow an existing prescribed scale
- Developers or clinics who want a simple open-source starting point

## Who it can help

This app can help reduce friction and mistakes when repeatedly looking up a dosing table. Instead of scanning a paper chart or note, users can enter a number and see the matching dose.

It may help:

- Make prescribed sliding scales easier to use
- Keep a simple local log of readings and calculated doses
- Give caregivers a clearer reference tool
- Provide a free alternative to locked-down or account-based apps

Again, this app does **not** decide what someone should take medically — it only applies the scale the user provides.

## Privacy

Settings and history are stored in the browser using `localStorage`.

That means:

- No account is required
- No data is sent to a server by the app
- Data stays on the device/browser where it was entered
- Data can be cleared by clearing browser/app storage
- Settings can be backed up and restored with JSON export/import

## Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

For LAN/Tailscale development, the dev server binds to `0.0.0.0`.

## Build

```bash
npm run build
npm run start
```

## Tech stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- PWA manifest + service worker

## License

This project is free and open-source software under the [MIT License](./LICENSE).
