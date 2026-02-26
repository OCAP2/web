import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { App } from "./App";
import { RecordingSelector } from "./pages/recording-selector";
import { RecordingPlayback } from "./pages/recording-playback";
import { MapManager } from "./pages/map-manager";
import { basePath } from "./data/basePath";

// Strip trailing slash for Router base prop (Router expects no trailing slash).
const routerBase = basePath.replace(/\/+$/, "");

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <Router base={routerBase} root={App}>
        <Route path="/" component={RecordingSelector} />
        <Route path="/recording/:id/:name" component={RecordingPlayback} />
        <Route path="/map-manager" component={MapManager} />
      </Router>
    ),
    root,
  );
}
