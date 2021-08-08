import './header.scss';

function Header({replay, onExitReplay, onViewChange}) {
	return (
		<div className="header">
			<div className="missionName">{replay?.missionName}{replay?.missionAuthor ? ` (${replay.missionAuthor})` : ""}</div>
			<div className="info">OCAP2</div>
			<div className="buttons">
				{replay && (<div className="button material-icons" title="Return to selection" onClick={() => onExitReplay()}>exit_to_app</div>)}
				{replay && (<div className="button material-icons" title="Watch replay" onClick={() => onViewChange("play2d")}>play_circle_outline</div>)}
				{replay && (<div className="button material-icons" title="Watch replay in 3D" onClick={() => onViewChange("play3d")}>smart_display</div>)}
				{replay && (<div className="button material-icons" title="View replay insights" onClick={() => onViewChange("insights")}>insights</div>)}
				{replay && (<div className="button material-icons" title="Share replay">share</div>)}
				<div className="button material-icons">help_outline</div>
			</div>
		</div>
	);
}

export default Header;
