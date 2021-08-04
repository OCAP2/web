import {useRef} from "react";
import {useFrame, useGraph, useLoader} from "@react-three/fiber";
import {OBJLoader} from "three/examples/jsm/loaders/OBJLoader";

function ObjectHeli() {
	// This reference will give us direct access to the mesh
	const mesh = useRef()
	// Set up state for the hovered and active state
	useFrame(() => {
		mesh.current.rotation.x = mesh.current.rotation.y += 0.01
	})

	const scene = useLoader(OBJLoader, "objects/heli.obj");
	const { nodes, materials } = useGraph(scene);

	console.log(nodes);

	return <mesh
		ref={mesh}
		geometry={nodes["18706_Fighter_Helicopter_v1.001"].geometry}
		material={materials.metal}
	/>
}

export default ObjectHeli;
