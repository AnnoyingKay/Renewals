RENEWALS v3 (2026-11-18)

A private household app for dates, costs and reminders: car service, insurance, NCT, motor tax and subscriptions.

Files (repository root): index.html, style.css, app.js, logic.js, sw.js, manifest.webmanifest, firebase-config.js, icon-192.png, icon-512.png

Setup
1. GitHub: create a new public repository called Renewals under the AnnoyingKay account (v1 may already exist).
2. Upload the files above, replacing any older copies, and commit.
3. Settings > Pages > Deploy from a branch > main, folder / (root), Save.
4. Open https://annoyingkay.github.io/Renewals/ and reload twice.
5. Sign in with the same Google account as the other apps.

Firestore rules
There is no rules file in this repository on purpose. The one master file lives in the Libraries repository. The collections Renewals uses are renewals, renewalsCars and renewalsHistory. They need the rule block added to the master file before the app can read or write anything.

Standalone
The app is its own page and is not part of Libraries. No hub entry is needed.

Data
renewals: one document per tracked item. Includes dueDate (ISO date) and status ("active" or "done"). A repeating item stays "active" and its dueDate moves on when it is done. Only one off items and items you stop tracking become "done".
renewalsCars: name, registration, odometer.
renewalsHistory: one row each time an item is done. Subscriptions add their own rows when a billing date passes.

Import and backup
Settings > Sync has Export backup and Import from file. Import reads a Renewals backup file (the same format Export makes), checks every row, and refuses the whole file if anything looks wrong. Rows with the same ID are replaced, so loading the same file twice changes nothing.

Privacy
Policy numbers, card numbers, bank details and PPS numbers are never stored. Free text that looks like one is refused. Registration number and provider name are fine.

Reminders
Phone notifications from a web app are unreliable, so the app does not depend on them. Every item has Add to calendar, which produces an .ics file with alarms at 09:00 on each reminder day. The Weekly summary on the Due tab can add the next two weeks in one file. The file holds the due date as it is today, so add it again after an item rolls on.


Home and themes (v3)
Home is the first tab: a themed header with a greeting, a dry line about renting digital things, the cost of the next 30 days, yearly subscription cost, an overdue banner and a swipeable row of cards for what is due next. Tap a card to turn it over for the detail. Themes live in Settings > Profile: Automatic, Calm, Night, Autobahn, Cinema Night, Parcel, Storybook, Household. All artwork is original. The service worker cache is renewals-v3.
