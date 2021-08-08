const lerp = (x, y, a) => x * (1 - a) + y * a;
const clamp = (a, min = 0, max = 1) => Math.min(max, Math.max(min, a));
const invlerp = (x, y, a) => clamp((a - x) / (y - x));
const range = (x1, y1, x2, y2, a) => lerp(x2, y2, invlerp(x1, y1, a));
const closestEquivalentAngle = (from, to) => {
	const delta = ((((to - from) % 360) + 540) % 360) - 180;
	return from + delta;
}

export class Entity {
	positions = [];
	frames = {
		start: -1,
		end: -1,
	}

	constructor({positions, frames}) {
		this.positions = positions.map((p) => ({
			position: {
				x: p[0][0],
				y: p[0][1],
				z: p[0][2],
			},
			orientation: {
				pitch: p[1][0],
				yaw: p[1][1],
				roll: p[1][2],
			},
			alive: p[2] !== 0,
			side: p[5],
		}));
		this.frames = frames;
	}

	isActive(frame) {
		return frame >= this.frames.start && frame <= this.frames.end;
	}

	getPosition(frame) {
		const frameStart = Math.floor(frame);
		const frameEnd = Math.ceil(frame);
		const frameDelta = frame - frameStart;

		const start = this.positions[frameStart].position;
		if (frameEnd >= this.frames.end) {
			return [start.x, start.y, start.z];
		}

		const end = this.positions[frameEnd].position;

		return [
			lerp(start.x, end.x, frameDelta),
			lerp(start.y, end.y, frameDelta),
			lerp(start.z, end.z, frameDelta),
		];
	}

	getOrientation(frame) {
		const frameStart = Math.floor(frame);
		const frameEnd = Math.ceil(frame);
		const frameDelta = frame - frameStart;

		const start = this.positions[frameStart].orientation;
		if (frameEnd >= this.frames.end) {
			return [start.pitch, start.yaw, start.roll];
		}

		const end = this.positions[frameEnd].orientation;

		return [
			lerp(start.pitch, closestEquivalentAngle(start.pitch, end.pitch), frameDelta),
			lerp(start.yaw, closestEquivalentAngle(start.yaw, end.yaw), frameDelta),
			lerp(start.roll, closestEquivalentAngle(start.roll, end.roll), frameDelta),
		];
	}

	getColor(frame) {
		const frameStart = Math.floor(frame);
		const position = this.positions[frameStart];
		if (!position.alive) {
			return [0,0,0,50];
		}

		let color;
		switch (position.side) {
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
}

export class Parachute extends Entity {}
export class Car extends Entity {}
export class Truck extends Entity {}
export class APC extends Entity {}
export class Tank extends Entity {}
export class Boat extends Entity {}
export class Helicopter extends Entity {}
export class Plane extends Entity {}
