import {APC, Boat, Car, Entity, Helicopter, Parachute, Plane, Tank, Truck} from './entity/entity';

export function normalizeReplay(replay) {
	replay.entityObjects = {
		parachute: [],
		car: [],
		truck: [],
		apc: [],
		tank: [],
		boat: [],
		helicopter: [],
		plane: [],
	};

	for (const entity of replay.entities) {
		const firstFrame = entity.startFrameNum;
		let lastFrame;

		const positions = Array.from(Array(replay.endFrame).keys()).map(() => [[0,0,0],[0,0,0]]);
		if (entity.type !== "unit" && entity.positions.some((d) => d.length >= 5)) {
			for (const position of entity.positions) {
				const startFrame = position[4][0];
				const endFrame = position[4][1];

				const crew = position[3];
				if (crew.length > 0) {
					const firstCrew = replay.entities.find((e) => e.id === crew[0]);
					if (firstCrew) {
						position.push(firstCrew.side);
					}
				}

				if (Array.isArray(position[1])) {
					position[1][0] = -position[1][0];
					position[1][1] = -position[1][1]+90;
				} else {
					position[1] = [0, -position[1]+90, 0];
				}

				for (let i = startFrame; i <= endFrame; i++) {
					positions[i] = position;
				}

				lastFrame = endFrame;
			}
		} else {
			lastFrame = entity.positions.length + entity.startFrameNum - 1;
			for (let i = 0; i < entity.positions.length; i++) {
				const positionIndex = i + entity.startFrameNum;
				positions[positionIndex] = entity.positions[i];

				if (Array.isArray(entity.positions[i][1])) {
					entity.positions[i][1][0] = -entity.positions[i][1][0];
					entity.positions[i][1][1] = -entity.positions[i][1][1]+90;
				} else {
					entity.positions[i][1] = [0, -entity.positions[i][1]+90, 0];
				}
			}
		}
		entity.positions = positions;

		if (entity.type !== "unit") {
			const entityConstructor = {
				positions: entity.positions,
				frames: {
					start: firstFrame,
					end: lastFrame,
				},
			};
			if (entity.class === "parachute") replay.entityObjects.parachute.push(new Parachute(entityConstructor));
			if (entity.class === "car") replay.entityObjects.car.push(new Car(entityConstructor));
			if (entity.class === "truck") replay.entityObjects.truck.push(new Truck(entityConstructor));
			if (entity.class === "apc") replay.entityObjects.apc.push(new APC(entityConstructor));
			if (entity.class === "tank") replay.entityObjects.tank.push(new Tank(entityConstructor));
			if (entity.class === "boat") replay.entityObjects.boat.push(new Boat(entityConstructor));
			if (entity.class === "heli") replay.entityObjects.helicopter.push(new Helicopter(entityConstructor));
			if (entity.class === "plane") replay.entityObjects.plane.push(new Plane(entityConstructor));
		}
	}
}

const RADIUS_EARTH = 6378000;
export function addLatLng([lat, lng], [x, y]) {
	let d = 180 / Math.PI
	let nlat = lat + (x / RADIUS_EARTH) * d
	let nlng = lng + (y / RADIUS_EARTH) * d / Math.cos(nlat * Math.PI / 180)
	return [nlat, nlng]
}
export function subLatLng([lat, lng], [x, y]) {
	let d = 180 / Math.PI
	let nlat = lat - (x / RADIUS_EARTH) * d
	let nlng = lng - (y / RADIUS_EARTH) * d / Math.cos(nlat * Math.PI / 180)
	return [nlat, nlng]
}

export function distance2D([x1,y1], [x2,y2]) {
	const a = x1 - x2;
	const b = y1 - y2;
	return Math.sqrt(a*a + b*b);
}

export function getSideColor(side) {
	let color;
	switch (side) {
		case "WEST":
			color = [100, 100, 140];
			break;
		case "EAST":
			color = [140, 100, 100];
			break;
		case "GUER":
			color = [100, 140, 0];
			break;
		default:
			color = [255,255,255];
	}

	return color;
}

export function getSideColorHighContrast(side) {
	let color;
	switch (side) {
		case "WEST":
			color = [100, 100, 255];
			break;
		case "EAST":
			color = [255, 100, 100];
			break;
		case "GUER":
			color = [100, 140, 0];
			break;
		default:
			color = [255,255,255];
	}

	return color;
}
