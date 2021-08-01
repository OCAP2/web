import './App.css';
import TopPanel from "./Panel/TopPanel";
import {useCallback, useState} from "react";
import Replay from "./Replay/Replay";
import Selection from "./Replay/Selection";

function App() {
	const [replay, setReplay] = useState(null);

	const onReplaySelect = useCallback((replay) => {
		fetch(`/data/${replay.filename}`)
			.then(r => r.json())
			.then(r => {
				setReplay(r);
			});
	}, []);
	const onExitReplay = useCallback(() => {
		setReplay(null);
	}, []);

	return (
		<div className="app">
			<TopPanel replay={replay} onExitReplay={onExitReplay}></TopPanel>
			{!replay && (
				<Selection onSelect={onReplaySelect}></Selection>
			)}
			{replay && (
				<Replay replay={replay}/>
			)}
		</div>
	);
}

export default App;
