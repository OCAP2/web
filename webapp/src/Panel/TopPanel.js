import './TopPanel.css';

function TopPanel({replay, onExitReplay, onViewChange}) {
	return (
		<div className="panel top">
			<div className="missionName">opt_v40</div>
			<div className="info">OCAP2</div>
			<div className="buttons">
				{replay && (<div className="button return" onClick={() => onExitReplay()} />)}
				{replay && (<div className="button play" onClick={() => onViewChange("play")}/>)}
				{replay && (<div className="button stats" onClick={() => onViewChange("analytics")}/>)}
				{replay && (<div className="button share"/>)}
				<div className="button info"/>
			</div>
		</div>
	);
}

export default TopPanel;
