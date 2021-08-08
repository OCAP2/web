import './app.scss';
import {useCallback, useState} from "react";
import Replay, {RENDERING_METHOD} from "./operation/replay/replay";
import Selection from "./operation/selection";
import Insights from "./operation/insights/insights";
import {normalizeReplay} from "./operation/converter";
import Header from "./header/header";

function App() {
	const [replay, setReplay] = useState(null);
	const [view, setView] = useState("play2d");

	const onReplaySelect = useCallback((replay) => {
		fetch(`/data/${replay.filename}`)
			.then(r => r.json())
			.then(r => {
				normalizeReplay(r);
				setReplay(r);
			});
	}, []);

	const onExitReplay = useCallback(() => {
		setReplay(null);
	}, []);

	return (
		<div className="app">
			<Header replay={replay} onExitReplay={onExitReplay} onViewChange={setView}/>
			{!replay && (<Selection onSelect={onReplaySelect}/>)}
			{replay && (view === "play2d" || view === "play3d") && (<Replay replay={replay} renderingMethod={view === "play3d" ? RENDERING_METHOD.Isometric : RENDERING_METHOD.TopDown}/>)}
			{replay && view === "insights" && (<Insights replay={replay}/>)}
		</div>
	);
}

export default App;
