import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { App } from "./App";
import { RecordingSelector } from "./pages/recording-selector";
import { RecordingPlayback } from "./pages/recording-playback";
import { basePath } from "./data/basePath";

// Strip trailing slash for Router base prop (Router expects no trailing slash).
const routerBase = basePath.replace(/\/+$/, "");

// Backwards compat: redirect ?op=<id> to /recording/<id>/<id>
const params = new URLSearchParams(window.location.search);
const op = params.get("op");
if (op) {
  const url = new URL(window.location.href);
  url.searchParams.delete("op");
  url.pathname = `${routerBase}/recording/${encodeURIComponent(op)}/${encodeURIComponent(op)}`;
  window.history.replaceState(null, "", url.toString());
}

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Router base={routerBase} root={App}>
        <Route path="/" component={RecordingSelector} />
        <Route path="/recording/:id/:name" component={RecordingPlayback} />
      </Router>
    ),
    root,
  );
}
