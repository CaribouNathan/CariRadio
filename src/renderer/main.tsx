import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** Filet de sécurité : une erreur d'affichage montre un message et un bouton, au lieu d'une fenêtre vide. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	state = { error: null as Error | null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	componentDidCatch(error: Error) {
		console.error("[CariRadio] erreur d'affichage :", error);
	}
	render() {
		if (!this.state.error) return this.props.children;
		return (
			<div className="crash">
				<h1>CariRadio a rencontré un problème d'affichage</h1>
				<code>{this.state.error.message}</code>
				<button onClick={() => location.reload()}>Recharger l'interface</button>
			</div>
		);
	}
}

createRoot(document.getElementById("root")!).render(
	<Boundary>
		<App />
	</Boundary>,
);
