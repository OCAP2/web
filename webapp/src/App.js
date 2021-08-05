import './App.css';
import TopPanel from "./Panel/TopPanel";
import {useCallback, useState} from "react";
import Replay from "./Replay/Replay";
import Selection from "./Replay/Selection";
import Analytics from "./Replay/Analytics/Analytics";
import {normalizeReplay} from "./Replay/Converter";
import Replay2 from "./Replay/Replay2";

function App() {
	const [replay, setReplay] = useState(null);
	const [view, setView] = useState("play");

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
			<TopPanel replay={replay} onExitReplay={onExitReplay} onViewChange={setView}></TopPanel>
			{!replay && (
				<Selection onSelect={onReplaySelect}></Selection>
			)}
			{replay && view === "play" && (
				<Replay replay={replay}/>
			)}
			{replay && view === "play2" && (
				<Replay2 replay={replay}/>
			)}
			{replay && view === "analytics" && (
				<Analytics replay={replay}/>
			)}
		</div>
	);
}

export default App;
