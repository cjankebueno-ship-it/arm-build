# Trainer Floor

Production app: https://trainer-floor.vercel.app/
Sales page: https://trainer-floor.vercel.app/sales.html
Sample-only UI preview: https://trainer-floor.vercel.app/preview.html

This static app is deployed by Vercel project `trainer-floor`, rooted at this directory. Its source branch is `trainer-floor-hosting`; do not deploy the repository's unrelated `main` app to this project. For releases, deploy the exact reviewed branch commit with target `production` and verify the public alias. Git branch rules in vercel.json exclude other branches. The older raw.githack URL remains a compatibility entry point; use the Vercel URL for new home-screen installations.

Supabase holds authenticated trainer data. Apply the root `database.sql` and `founder-offer.sql` migrations once; they are already applied to the connected project. Public clients use a publishable key; no server credential belongs in this directory. Completed records and revision history are protected by trainer ownership policies. Saves use optimistic revisions and idempotent mutation IDs with a per-account device queue.

The authenticated import API is maintained in the private `chrisjanke.com` repository at `app/api/trainer-floor/parse-history`. Its production URL is https://members.chrisjanke.com/api/trainer-floor/parse-history. The parser accepts notes and PDFs up to 2 MB. AI results are reviewed before the frontend writes actual completed session rows. Completion assumptions are labeled, missing details stay unknown, and future programs can be imported as templates instead. Trainerize client CSVs provide roster information, not completed workout histories.

The founding offer is $19/month or $190/year, with a free three-active-client plan. The first 25 authenticated reservations protect the advertised rate under the displayed continuity terms. Reservations are real database records and cost $0. Billing is not implemented: there is no payment collection, automatic subscription, or unlimited-client unlock from reserving. Do not advertise paid checkout until subscription creation, webhooks, cancellation and entitlements are implemented and tested.

Asana status UI displays a configured account integration and sync receipts. It does not itself run an Asana sync worker.

Run `TZ=America/Los_Angeles node --test tests/*.test.cjs` from the repository root. The sample preview is isolated in a sandbox and uses synthetic data; it never saves to a real account. Backend import tests are in the private repository. Bump app asset query versions and the service-worker cache together when publishing a new app release.
