// Cross-page view transitions (decision 0014). Now and then the browser
// gives a transition up: another navigation started, or the next page
// doesn't take part. Its promises then reject. This answers them on every
// page, from the <head>, so it's listening before the first frame (a
// component mounts too late for that) and no error reaches the page.
(() => {
  const quiet = (transition) => {
    if (!transition) return;
    for (const name of ["ready", "finished", "updateCallbackDone"]) transition[name]?.catch(() => {});
  };
  addEventListener("pageswap", (event) => quiet(event.viewTransition));
  addEventListener("pagereveal", (event) => quiet(event.viewTransition));
})();
