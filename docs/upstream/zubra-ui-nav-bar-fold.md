# zubra-ui: nav-bar folds by width, not by what fits

Status: not filed yet. This session could not open issues on journey-to-code-org/zubra-ui. File it as is.

`nav-bar.zb` folds its links behind **Menu** only when the bar is narrower than `40rem` (`@container (max-width: 40rem)`). The fold does not depend on how many links there are.

With ten links and two action buttons (Potomac HQ's top bar), everything fits on one row from about 1,090px. Between 641px and about 1,090px the links and actions run off the right edge: at 768px, "Money", "Reports", "Knowledge", "Settings" and "Sign out" are outside the screen, and the page scrolls sideways.

**To reproduce:** a `nav-bar` with ten links of ordinary length, a `brand` slot and two buttons in `actions`, at 900px wide.

**Expected:** the links fold behind Menu, or wrap, when they do not fit, whatever the width.

**Worked around in Potomac HQ** with page CSS between 641px and 1,120px that lets `.navbar-links` wrap onto a second row. That reaches into the component's classes, so it breaks if they are renamed.

found-by: potomac
