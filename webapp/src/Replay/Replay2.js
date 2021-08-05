import './Replay2.css';
import {Canvas} from "@react-three/fiber";
import ObjectHeli from "../Object/Heli";
import {useEffect, useRef} from "react";
import {
	DirectionalLight,
	DoubleSide, HemisphereLight, Mesh,
	MeshPhongMaterial,
	NearestFilter,
	PerspectiveCamera, PlaneGeometry,
	RepeatWrapping,
	Scene,
	TextureLoader,
	WebGLRenderer,
	Color
} from "three";
import {OBJLoader} from "three/examples/jsm/loaders/OBJLoader";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls";

function Replay2({replay}) {
	const canvas = useRef();

	useEffect(() => {
		setTimeout(() => {
			const renderer = new WebGLRenderer({
				canvas: canvas.current,
			});

			const fov = 45;
			const aspect = 2;  // the canvas default
			const near = 0.1;
			const far = 20000;
			const camera = new PerspectiveCamera(fov, aspect, near, far);
			camera.position.set(0, 10, 20);

			const controls = new OrbitControls(camera, canvas.current);
			controls.target.set(0, 5, 0);
			controls.update();

			const scene = new Scene();
			scene.background = new Color('blue');

			{
				const planeSize = 18001;

				const loader = new TextureLoader();
				const texture = loader.load('https://threejsfundamentals.org/threejs/resources/images/checker.png');
				texture.wrapS = RepeatWrapping;
				texture.wrapT = RepeatWrapping;
				texture.magFilter = NearestFilter;
				const repeats = planeSize / 2;
				texture.repeat.set(repeats, repeats);

				const planeGeo = new PlaneGeometry(planeSize, planeSize);
				const planeMat = new MeshPhongMaterial({
					map: texture,
					side: DoubleSide,
				});
				const mesh = new Mesh(planeGeo, planeMat);
				mesh.rotation.x = Math.PI * -.5;
				scene.add(mesh);
			}

			{
				const skyColor = 0xB1E1FF;  // light blue
				const groundColor = 0xB97A20;  // brownish orange
				const intensity = 1;
				const light = new HemisphereLight(skyColor, groundColor, intensity);
				scene.add(light);
			}

			{
				const objLoader = new OBJLoader();
				objLoader.load('objects/heli.obj', (root) => {
					root.rotation.x = Math.PI * -.5;
					let added = false;
					setInterval(() => {
						added = !added;
						if (added) {
							scene.add(root);
						} else {
							scene.remove(root);
						}
					}, 2000)
				});
			}

			function resizeRendererToDisplaySize(renderer) {
				const canvas = renderer.domElement;
				const width = canvas.clientWidth;
				const height = canvas.clientHeight;
				const needResize = canvas.width !== width || canvas.height !== height;
				if (needResize) {
					renderer.setSize(width, height, false);
				}
				return needResize;
			}

			function render() {
				// if (resizeRendererToDisplaySize(renderer)) {
				// 	const canvas = renderer.domElement;
				// 	camera.aspect = canvas.clientWidth / canvas.clientHeight;
				// 	camera.updateProjectionMatrix();
				// }

				renderer.render(scene, camera);

				requestAnimationFrame(render);
			}

			requestAnimationFrame(render);
		}, 100);

	}, [canvas.current, replay])

	return (
		<Canvas
		ref={canvas}>
		</Canvas>
	);
}

export default Replay2;
