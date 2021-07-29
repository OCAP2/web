import './LeftPanel.css';

function LeftPanel() {
	return (
		<div className="panel left">
			<div className="title">Players</div>
			<div className="units"></div>
			<div className="sideSelector">
				<div className="west">BLUFOR</div>
				<div className="east">OPFOR</div>
				<div className="guer">IND</div>
				<div className="civ">CIV</div>
			</div>
		</div>
	);
}

export default LeftPanel;
