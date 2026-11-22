# kit: the staff lockout is counted in memory

Status: not filed yet. This session has no access to the kit's repository. File it as is.

`modules/staff` locks an email and address pair for fifteen minutes after too many wrong passwords. It counts the failures in a `Map` in memory (`failures`), so a restart forgets them and hands out a fresh set of tries. Everything else the module keeps (accounts, sessions, links) goes through the store.

**To reproduce:** sign in with a wrong password until the account locks, restart the process, and sign in with a wrong password again. It is accepted as a fresh try.

**Expected:** the failures are kept in the store, like sessions, so a lock lasts its fifteen minutes whatever happens to the process.

**In Potomac HQ** the limits HQ adds itself (per address on both sign-ins, the two-factor step, "Forgot your password?") are kept in the database since 0.11.0, so a restart resets only the kit's lock, not HQ's limits.

found-by: potomac
