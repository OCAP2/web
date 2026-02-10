import { render } from "solid-js/web";
import { App } from "./App";
import type { MapRenderer } from "./renderers/renderer.interface";
import { LeafletRenderer } from "./renderers/leaflet/leaflet-renderer";

async function bootstrap(): Promise<void> {
  let renderer: MapRenderer;
  const params = new URLSearchParams(window.location.search);
  if (params.get("renderer") === "deckgl") {
    const { DeckGLRenderer } = await import("./renderers/deckgl/deckgl-renderer");
    renderer = new DeckGLRenderer();
  } else {
    renderer = new LeafletRenderer();
  }

  const root = document.getElementById("root");
  if (root) {
    render(() => <App renderer={renderer} />, root);
  }
}

void bootstrap();
