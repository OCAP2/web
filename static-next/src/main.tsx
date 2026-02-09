import { render } from "solid-js/web";

function App() {
  return <h1>OCAP2</h1>;
}

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
