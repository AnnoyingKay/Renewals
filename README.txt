RENEWALS v1 (2026-11-18)

A private household app for dates, costs and reminders: car service, insurance, NCT, motor tax and subscriptions.

Files (repository root): index.html, style.css, app.js, logic.js, sw.js, manifest.webmanifest, firebase-config.js, icon-192.png, icon-512.png

Setup
1. GitHub: create a new public repository called Renewals under the AnnoyingKay account.
2. Upload the files above and commit.
3. Settings > Pages > Deploy from a branch > main, folder / (root), Save.
4. Open https://annoyingkay.github.io/Renewals/ and reload twice.
5. Sign in with the same Google account as the other apps.

Firestore rules
There is no rules file in this repository on purpose. The one master file lives in the Libraries repository. The collections Renewals uses are renewals, renewalsCars and renewalsHistory. They need the rule block added to the master file before the app can read or write anything.

Showing it inside Libraries
The page works on its own and inside the Libraries iframe on the same address. Libraries needs one new entry in its LIBS list pointing at ../Renewals/.

Data
renewals: one document per tracked item. Includes dueDate (ISO date) and status ("active" or "done"). A repeating item stays "active" and its dueDate moves on when it is done. Only one off items and items you stop tracking become "done".
renewalsCars: name, registration, odometer.
renewalsHistory: one row each time an item is done. Subscriptions add their own rows when a billing date passes.

Privacy
Policy numbers, card numbers, bank details and PPS numbers are never stored. Free text that looks like one is refused. Registration number and provider name are fine.

Reminders
Phone notifications from a web app are unreliable, so the app does not depend on them. Every item has Add to calendar, which produces an .ics file with alarms at 09:00 on each reminder day. The Weekly summary on the Due tab can add the next two weeks in one file. The file holds the due date as it is today, so add it again after an item rolls on.
