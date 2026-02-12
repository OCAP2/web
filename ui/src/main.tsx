import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { App } from "./App";
import { MissionSelector } from "./pages/mission-selector";
import { LoadingTransition } from "./pages/LoadingTransition";
import { RecordingPlayback } from "./pages/RecordingPlayback";

// Backwards compat: redirect ?op=<id> to /recording/<id>
const params = new URLSearchParams(window.location.search);
const op = params.get("op");
if (op) {
  const url = new URL(window.location.href);
  url.searchParams.delete("op");
  url.pathname = `/recording/${encodeURIComponent(op)}`;
  window.history.replaceState(null, "", url.toString());
}

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Router root={App}>
        <Route path="/" component={MissionSelector} />
        <Route path="/loading/:id" component={LoadingTransition} />
        <Route path="/recording/:id" component={RecordingPlayback} />
      </Router>
    ),
    root,
  );
}
