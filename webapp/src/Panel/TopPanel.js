import './TopPanel.css';

function TopPanel() {
	return (
		<div className="panel top">
			<div className="missionName">opt_v40</div>
			<div className="info">OCAP2</div>
			<div className="buttons">
				<div className="button return"/>
				<div className="button share"/>
				<div className="button info"/>
				<div className="button stats"/>
			</div>
		</div>
	);
}

export default TopPanel;
