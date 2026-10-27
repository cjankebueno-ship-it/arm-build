# Trainer Floor

Production app: https://trainer-floor.vercel.app/
Sales page: https://trainer-floor.vercel.app/sales.html
Sample-only UI preview: https://trainer-floor.vercel.app/preview.html

This static app is deployed by Vercel project `trainer-floor`, rooted at this directory. Its source branch is `trainer-floor-hosting`; do not deploy the repository's unrelated `main` app to this project. For releases, deploy the exact reviewed branch commit with target `production` and verify the public alias. Git branch rules in vercel.json exclude other branches. The older raw.githack URL remains a compatibility entry point; use the Vercel URL for new home-screen installations.

Supabase holds authenticated trainer data. Apply the root `database.sql` and `founder-offer.sql` migrations once; they are already applied to the connected project. Public clients use a publishable key; no server credential belongs in this directory. Completed records and revision history are protected by trainer ownership policies. Saves use optimistic revisions and idempotent mutation IDs with a per-account device queue.

The authenticated import API is maintained in the private `chrisjanke.com` repository at `app/api/trainer-floor/parse-history`. Its production URL is https://members.chrisjanke.com/api/trainer-floor/parse-history. The parser accepts notes and PDFs up to 2 MB. AI results are reviewed before the frontend writes actual completed session rows. Completion assumptions are labeled, missing details stay unknown, and future programs can be imported as templates instead. Trainerize client CSVs provide roster information, not completed workout histories.

The founding offer is $19/month or $190/year, with a free three-active-client plan. The first 25 authenticated reservations protect the advertised rate under the displayed continuity terms. Reservations are real database records and cost $0. Marketing and account UI do not display signup totals, remaining reservation counts, or sequential trainer/reservation numbers. Only the actual offer limit and open/closed availability may be shown. Billing is not implemented: there is no payment collection, automatic subscription, or unlimited-client unlock from reserving. Do not advertise paid checkout until subscription creation, webhooks, cancellation and entitlements are implemented and tested.

Asana is not available yet: OAuth authorization and a sync worker still need implementation. Settings includes a Connect Asana button that explains this limitation, plus an accessible question-mark disclosure about keeping an extra workout log in Asana. It does not request credentials, change the integration record, or claim a successful connection. Do not replace the setup message with a connected state until authorization and actual syncing work.

Run `TZ=America/Los_Angeles node --test tests/*.test.cjs` from the repository root. The sample preview is isolated in a sandbox and uses synthetic data; it never saves to a real account. Backend import tests are in the private repository. Bump app asset query versions and the service-worker cache together when publishing a new app release.

Appearance: choose Light or Dark in Settings or on the sign-in screen. The preference is stored on the device and applied before initial rendering. Theme changes do not re-render workouts or reset rest timers.
