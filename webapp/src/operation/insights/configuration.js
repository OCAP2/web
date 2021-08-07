import "./configuration.css";
import {useCallback, useState} from "react";
import {INITIAL_CONFIG} from "./insights";

function LeftPanel({onConfigChange}) {
	const [config, setConfig] = useState(INITIAL_CONFIG);

	const changeConfig = useCallback((module, key, value) => {
		const newConfig = {...config};
		newConfig[module][key] = value;
		setConfig(newConfig);
		onConfigChange(newConfig);
	}, [config, onConfigChange]);
	const changeConfig2 = useCallback((module, key, key2, value) => {
		const newConfig = {...config};
		newConfig[module][key][key2] = value;
		setConfig(newConfig);
		onConfigChange(newConfig);
	}, [config, onConfigChange]);

	return (
		<div className="panel left">
			<div className="title">Configuration</div>
			<div className="config">
				<div>
					<div className="configGroup" onClick={() => changeConfig("activityHexagon", "visible", !config.activityHexagon.visible)}>
						<input
							type="checkbox"
							readOnly={true}
							checked={config.activityHexagon.visible}
						/>
						Activity
					</div>
					<div className="configOption">
						<div>Radius in meter: {config.activityHexagon.radius}</div>
						<input
							type="range"
							min="5"
							max="100"
							step="5"
							value={config.activityHexagon.radius}
							onChange={(v) => { changeConfig("activityHexagon", "radius", +v.target.value); }}
						/>
					</div>
					<div className="configOption">
						<div>Elevation scale: {config.activityHexagon.elevationScale}</div>
						<input
							type="range"
							min="1"
							max="10"
							step="1"
							value={config.activityHexagon.elevationScale}
							onChange={(v) => { changeConfig("activityHexagon", "elevationScale", +v.target.value); }}
						/>
					</div>
					<div className="configOption">
						<div>Upper percentile: {config.activityHexagon.upperPercentile}</div>
						<input
							type="range"
							min="98"
							max="100"
							step="0.1"
							value={config.activityHexagon.upperPercentile}
							onChange={(v) => { changeConfig("activityHexagon", "upperPercentile", +v.target.value); }}
						/>
					</div>
					<div className="configGroup" onClick={() => changeConfig("travelRoutes", "visible", !config.travelRoutes.visible)}>
						<input
							type="checkbox"
							readOnly={true}
							checked={config.travelRoutes.visible}
						/>
						Travel routes
					</div>
					<div className="configOption">
						Animate:
						<input
							type="checkbox"
							onChange={(v) => { changeConfig("travelRoutes", "animate", v.target.checked); }}
						/>
					</div>
					<div className="configOption">
						Show Cars:
						<input
							type="checkbox"
							defaultChecked={config.travelRoutes.include.car}
							onChange={(v) => { changeConfig2("travelRoutes", "include", "car", v.target.checked); }}
						/>
					</div>
					<div className="configOption">
						Show Trucks:
						<input
							type="checkbox"
							defaultChecked={config.travelRoutes.include.truck}
							onChange={(v) => { changeConfig2("travelRoutes", "include", "truck", v.target.checked); }}
						/>
					</div>
					<div className="configOption">
						Show APCs:
						<input
							type="checkbox"
							defaultChecked={config.travelRoutes.include.apc}
							onChange={(v) => { changeConfig2("travelRoutes", "include", "apc", v.target.checked); }}
						/>
					</div>
					<div className="configOption">
						Show Tanks:
						<input
							type="checkbox"
							defaultChecked={config.travelRoutes.include.tank}
							onChange={(v) => { changeConfig2("travelRoutes", "include", "tank", v.target.checked); }}
						/>
					</div>
					<div className="configOption">
						Show Helicopter:
						<input
							type="checkbox"
							defaultChecked={config.travelRoutes.include.heli}
							onChange={(v) => { changeConfig2("travelRoutes", "include", "heli", v.target.checked); }}
						/>
					</div>
					<div className="configOption">
						Show Planes:
						<input
							type="checkbox"
							defaultChecked={config.travelRoutes.include.plane}
							onChange={(v) => { changeConfig2("travelRoutes", "include", "plane", v.target.checked); }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export default LeftPanel;
